import { expect, mock, test } from 'claude-code/testing'

import type { BoardSnapshot, Delegation, TicketStatus } from '../types'
import { applyResult, cardMoveFor, fromRun, fromRunLog, movePrompt, parseRelay, parseShortstat, progressOf, sameRun, syncPrompt, taskOf, ticketOf } from '../hooks/features/delegations'
import { promptFor } from '../hooks/kit/prompts'
import { mcDirsOf } from '../hooks/kit/paths'
import { alternativeTo, isLimitedResult, limitedAt, limitFromLogLine, limitNote, limitsFromActivity, limitsFromDelegations } from '../hooks/kit/limits'


const PANE = {
  component: 'Pane' as const,
  requestId: 'mission-control',
  props: { title: 'Mission Control', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

const base: Delegation = { id: 'x', tool: 'agy', task: 'Fix RTL classes', project: 'Portal', cwd: 'C:/w/portal', branch: 'fix/rtl-header', startedAt: 0, status: 'review', now: 'Finished' }

test('relay commands are recognised and their flags parsed; other commands are ignored', async () => {
  const c = parseRelay('node "C:/Users/a/.claude/skills/codex-delegate/scripts/relay.mjs" --brief brief.txt --cd "C:/w/My Repo" --model gpt-5 --out-dir=/tmp/o && echo done')
  expect(c).toEqual({ tool: 'codex', cd: 'C:/w/My Repo', brief: 'brief.txt', model: 'gpt-5', outDir: '/tmp/o', heredoc: undefined })
  expect(parseRelay('node /x/opencode-delegate/scripts/relay.mjs --cd /r')?.tool).toBe('opencode')
  expect(parseRelay('node /x/claude-delegate/scripts/relay.mjs --cd /r')?.tool).toBe('claude')
  expect(parseRelay('npm test')).toBeNull()
  expect(parseRelay(undefined)).toBeNull()
  expect(taskOf('\n# M0-007 Implement the budget band\nmore')).toBe('M0-007 Implement the budget band')
  expect(ticketOf('M0-007 Implement it')).toBe('M0-007')
  expect(ticketOf('Use UTF-8 here')).toBeUndefined()
})

test('a run wrapped by run-log names its GitHub issue; a brief can name one too', () => {
  const cmd = '[ -n "$MC_RUN_LOG" ] && node "$MC_RUN_LOG" start --agent codex --issue 28 --model gpt-6 --cd /w/app || true\nnode "/s/codex-delegate/scripts/relay.mjs" --cd /w/app --brief b.md'
  const c = parseRelay(cmd)!
  expect(c).toMatchObject({ tool: 'codex', cd: '/w/app', brief: 'b.md', issue: '28' })
  expect(ticketOf('M0-007 old ticket', c.issue)).toBe('#28')
  expect(ticketOf('Fix the backup job (#35), see M0-201')).toBe('#35')
  expect(ticketOf('# Heading\nStep #1 is not an issue? It is: #1')).toBe('#1')
  expect(ticketOf('color #fff')).toBeUndefined()
})

test('run-log lines become finished delegations, and a run seen live is not doubled', () => {
  const line = { ts: '2026-10-20T04:00:00Z', actor: 'codex', ticket: null, event: 'run.completed', issue: 28, source: 'run-log',
    detail: { agent: 'codex', model: 'gpt-6', worktree: 'D:\\w\\app\\.claude\\worktrees\\mc', branch: 'claude/mc', durationSec: 600, touchedFiles: 4 } }
  const d = fromRunLog(line, new Map([['#28', 'Mission Control reads GitHub']]))!
  expect(d).toMatchObject({ tool: 'codex', ticket: '#28', task: 'Mission Control reads GitHub', project: 'mc', cwd: 'D:/w/app/.claude/worktrees/mc', branch: 'claude/mc', model: 'gpt-6', files: 4, status: 'done' })
  expect(d.endedAt! - d.startedAt).toBe(600_000)
  expect(fromRunLog({ ...line, issue: null }, new Map())?.task).toBe('Delegated task')
  expect(fromRunLog({ ...line, event: 'run.started' }, new Map())).toBeNull()
  expect(fromRunLog({ ...line, source: 'hook' }, new Map())).toBeNull()
  const live: Delegation = { ...base, id: 'toolu_1', tool: 'codex', cwd: 'd:/w/app/.claude/worktrees/mc', startedAt: d.startedAt + 3000, status: 'running' }
  expect(sameRun(live, d)).toBe(true)
  expect(sameRun({ ...live, tool: 'agy' }, d)).toBe(false)
  expect(sameRun({ ...live, startedAt: d.startedAt - 3_600_000 }, d)).toBe(false)
})

test('result.json of any shape maps to a status without throwing', async () => {
  expect(applyResult({ status: 'completed', finalMessage: 'Done. 42 tests passed', touchedFiles: ['a', 'b'] }, 5)).toMatchObject({ status: 'review', files: 2, tests: { passed: 42, failed: 0, ran: true } })
  expect(applyResult({ status: 'failed', stderrTail: ['tsc failed: 2 type errors'] }, 5)).toMatchObject({ status: 'failed', error: 'tsc failed: 2 type errors' })
  expect(applyResult({ status: 'timeout' }, 5).status).toBe('failed')
  for (const odd of [null, 7, 'x', [], { status: 3, touchedFiles: 'no', tests: 'x' }]) expect(applyResult(odd, 5).status).toBe('review')
  expect(parseShortstat(' 4 files changed, 182 insertions(+), 20 deletions(-)')).toEqual({ files: 4, added: 182, removed: 20 })
  expect(parseShortstat('')).toBeUndefined()
  expect(fromRun({ codexVersion: '1', status: 'completed', verdict: 'accepted', finishedAt: '2026-10-09T10:00:00Z' }, 'r', 'P', '/p', 'M0-001', 1)?.status).toBe('merged')
  expect(fromRun({ status: 'failed', codexVersion: '1' }, 'r', 'P', '/p', '', 1)).toBeNull()
  expect(progressOf({ ...base, status: 'running', startedAt: 0 }, 180000)).toMatchObject({ kind: 'est', ratio: 0.5 })
  expect(promptFor('review', base)).toBe('Review the diff from agy on fix/rtl-header in C:/w/portal and tell me if it is ready to merge.')
})

const ghBoard = (status: TicketStatus, kind: 'github' | 'ops' = 'github'): BoardSnapshot => ({
  root: 'D:/w/mos', project: 'mos', activity: [], readAt: 0,
  tickets: [{ id: '#28', title: 'Mission Control reads GitHub', status, url: 'https://github.com/aessamm/mos/issues/28', path: '' }],
  source: kind === 'github' ? { kind: 'github', repo: 'aessamm/mos', board: 'Agenca #3', url: 'https://github.com/users/aessamm/projects/3', fetchedAt: 0 } : { kind: 'ops' },
})
const run28: Delegation = { ...base, tool: 'codex', ticket: '#28', branch: 'claude/mc' }

test('a finished run suggests moving its card forwards on a GitHub board, and only then', () => {
  expect(cardMoveFor(run28, ghBoard('todo'))).toMatchObject({ issue: '#28', from: 'Todo', to: 'Review' })
  expect(cardMoveFor({ ...run28, status: 'done' }, ghBoard('in_progress'))).toMatchObject({ from: 'In progress', to: 'Review' })
  expect(cardMoveFor({ ...run28, status: 'merged' }, ghBoard('in_review'))).toMatchObject({ from: 'Review', to: 'Done' })
  expect(cardMoveFor({ ...run28, status: 'merged' }, ghBoard('waiting'))?.to).toBe('Done')
  // already there or further
  for (const s of ['in_review', 'waiting', 'done'] as const) expect(cardMoveFor(run28, ghBoard(s))).toBeNull()
  expect(cardMoveFor({ ...run28, status: 'merged' }, ghBoard('done'))).toBeNull()
  // not finished, not a GitHub issue, not a GitHub board, not on the board
  for (const status of ['running', 'failed'] as const) expect(cardMoveFor({ ...run28, status }, ghBoard('todo'))).toBeNull()
  expect(cardMoveFor({ ...run28, ticket: 'M0-007' }, ghBoard('todo'))).toBeNull()
  expect(cardMoveFor({ ...run28, ticket: undefined }, ghBoard('todo'))).toBeNull()
  expect(cardMoveFor(run28, ghBoard('todo', 'ops'))).toBeNull()
  expect(cardMoveFor({ ...run28, ticket: '#29' }, ghBoard('todo'))).toBeNull()
  expect(cardMoveFor(run28, null)).toBeNull()
})

test('the move and sync prompts name the repo, the board and the Status, and ask first', () => {
  const b = ghBoard('todo')
  expect(movePrompt(cardMoveFor(run28, b)!, run28, b)).toBe(
    'Move issue #28 "Mission Control reads GitHub" of aessamm/mos on the project board "Agenca" (number 3) at https://github.com/users/aessamm/projects/3 from Todo to the Status "Review": the Codex run on claude/mc is waiting for review. '
    + 'Use `gh project item-edit` (look up the project, item and Status field ids with `gh project item-list` and `gh project field-list`) or Mission Control\'s tools. '
    + 'Tell me exactly what you will change and wait for my go before moving the card.')
  const done = { ...run28, status: 'merged' as const }
  expect(movePrompt(cardMoveFor(done, b)!, done, b)).toContain('to the Status "Done": I marked its run merged.')
  expect(syncPrompt('D:/w/mission-control/scripts/board-sync.mjs', b)).toBe(
    'Run `node "D:/w/mission-control/scripts/board-sync.mjs" --dry-run` to see which cards of aessamm/mos on the project board "Agenca" (number 3) at https://github.com/users/aessamm/projects/3 are out of step with the work, and show me the moves it lists. '
    + 'Only if I agree, run it again without --dry-run to apply them.')
  expect(mcDirsOf(' D:\\mc\\ ', 'D:\\mc\\scripts\\run-log.mjs', 'D:/w/mos')).toEqual(['D:/mc', 'D:/w/mission-control'])
  expect(mcDirsOf(undefined, '/x/other.mjs', '')).toEqual([])
})

test('the Delegations tab shows the card move and Sync board, and the buttons only fill the composer', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-20T12:00:00Z') })
  const cache = (status: string) => JSON.stringify({
    schema: 'mc.github-tasks.v1', fetchedAt: '2026-10-20T11:50:00Z', repo: 'aessamm/mos',
    project: { owner: 'aessamm', number: 3, title: 'Agenca', url: 'https://github.com/users/aessamm/projects/3' },
    issues: [{ number: 28, title: 'Mission Control reads GitHub', state: 'open', labels: [], assignees: [], status }],
  })
  const files: Record<string, string> = {
    '/w/mission-control/.cache/github-tasks.json': cache('In progress'),
    '/w/app/.ops/log/activity.jsonl': JSON.stringify({ ts: '2026-10-20T11:30:00Z', actor: 'codex', event: 'run.completed', issue: 28, source: 'run-log', detail: { agent: 'codex', worktree: '/w/app', branch: 'claude/mc', durationSec: 600 } }),
  }
  on('session.start', () => ({ cwd: '/w/app' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  on('session.root', () => ({ value: '/w/app' }))
  on('session.repo', () => ({ value: { root: '/w/app', name: 'app', remote: 'https://github.com/aessamm/mos.git', internal: false } }))
  on('fs.exists', (_$, e) => ({ value: norm(e.path).endsWith('/w/mission-control/scripts/board-sync.mjs') }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_$, e) => (lookup(files, e.path) === undefined ? { deny: 'ENOENT' } : { value: lookup(files, e.path) as string }))
  let filled = ''
  on('prompt.fill', (_$, e) => { filled = e.text; return { isFilled: true } })
  await $.session.start({ cwd: '/w/app', surface: null, isInteractive: true })
  await clock.advance(31_000)
  const open = async (surface: 'terminal' | 'desktop') => {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-delegations' })
    return ui
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await open(surface)
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('Move #28 to Review')
    expect(drawn).toContain('Sync board')
    await ui.press({ key: 'move-log:codex:2026-10-20T11:30:00Z' })
    expect(filled).toContain('Move issue #28 "Mission Control reads GitHub" of aessamm/mos on the project board "Agenca" (number 3)')
    expect(filled).toContain('from In progress to the Status "Review"')
    await ui.press({ key: 'sync-board' })
    expect(filled).toContain('mission-control/scripts/board-sync.mjs" --dry-run')
    await ui.unmount()
  }
  // Once the card is in Review, nothing more is suggested.
  files['/w/mission-control/.cache/github-tasks.json'] = cache('Review')
  await clock.advance(5 * 60_000)
  const ui = await open('terminal')
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).not.toContain('Move #28')
  expect(drawn).toContain('Sync board')
  await ui.unmount()
})

const T0 = Date.parse('2026-10-20T12:00:00Z')
const limitLine = (o: Record<string, unknown>) => ({ ts: '2026-10-20T11:40:00Z', actor: 'codex', event: 'run.completed', source: 'run-log', detail: { agent: 'codex', rateLimited: true }, ...o })

test('who is rate limited comes from run-log lines and results, inside the window', () => {
  expect(limitFromLogLine(limitLine({}))).toEqual({ tool: 'codex', at: Date.parse('2026-10-20T11:40:00Z') })
  expect(limitFromLogLine(limitLine({ event: 'run.failed', actor: 'agy', detail: { agent: 'agy', reason: 'usage limit reached' } }))?.tool).toBe('agy')
  expect(limitFromLogLine(limitLine({ event: 'run.failed', detail: { agent: 'codex', reason: 'exit 1' } }))).toBeNull()
  expect(limitFromLogLine(limitLine({ detail: { agent: 'codex', rateLimited: false } }))).toBeNull()
  expect(limitFromLogLine(limitLine({ event: 'run.started' }))).toBeNull()
  expect(limitFromLogLine(limitLine({ source: 'hook' }))).toBeNull()
  expect(isLimitedResult({ status: 'failed', stderrTail: ['HTTP 429 Too Many Requests'] })).toBe(true)
  expect(isLimitedResult({ rateLimited: true })).toBe(true)
  expect(isLimitedResult({ status: 'completed', finalMessage: 'Done' })).toBe(false)
  // A run that finished fine is not limited, even when its final message talks about rate limits.
  expect(isLimitedResult({ status: 'completed', exitCode: 0, finalMessage: 'Added a rate limit warning and a 429 test' })).toBe(false)
  expect(isLimitedResult({ status: 'failed', exitCode: 1, finalMessage: 'usage limit reached, try again at 9' })).toBe(true)
  const log = [
    '{"ts":"2026-10-22T05:00:00Z","actor":"codex","event":"run.failed","source":"run-log","detail":{"agent":"codex","reason":"429 Too Many Requests"}}',
    '{"ts":"2026-10-22T05:10:00Z","actor":"claude","event":"session.started","source":"hook"}',
    'not json',
    '{"ts":"2026-10-22T05:20:00Z","actor":"agy","event":"run.completed","source":"run-log","detail":{"agent":"agy","rateLimited":true}}',
  ].join('\n')
  expect(limitsFromActivity(log).map(hit => hit.tool)).toEqual(['codex', 'agy'])
  expect(limitsFromActivity('{"event":"x"}')).toEqual([])
  expect(applyResult({ status: 'failed', error: 'rate limit exceeded' }, 5)).toMatchObject({ status: 'failed', rateLimited: true })
  expect(limitsFromDelegations([{ ...base, rateLimited: true, endedAt: 9 }, base])).toEqual([{ tool: 'agy', at: 9 }])

  const hits = [{ tool: 'codex' as const, at: T0 - 20 * 60_000 }, { tool: 'codex' as const, at: T0 - 50 * 60_000 }, { tool: 'agy' as const, at: T0 - 61 * 60_000 }]
  const limited = limitedAt(hits, T0)
  expect(limited).toEqual({ codex: { at: T0 - 20 * 60_000, until: T0 + 40 * 60_000 } })
  expect(limitedAt(hits, T0, 10 * 60_000)).toEqual({})
  expect(alternativeTo('codex', limited)).toBe('claude')
  expect(alternativeTo('claude', { codex: { at: 0, until: 1 } })).toBe('agy')
  expect(limitNote('codex', limited, T0)).toBe('Codex hit a rate limit 20 min ago (counted as limited for 40 more min); Claude is free to take it instead.')
  expect(limitNote('agy', limited, T0)).toBe('')
  const all = { codex: { at: T0, until: T0 + 1 }, agy: { at: T0, until: T0 + 1 }, opencode: { at: T0, until: T0 + 1 }, claude: { at: T0, until: T0 + 1 } }
  expect(limitNote('codex', all, T0)).toContain('every implementer is limited')
})

test('a relay for a recently limited implementer toasts and notes it on its card, and still runs', { timeoutMs: 30_000 }, async ($, on) => {
  mock.clock(on, { now: T0 })
  const files: Record<string, string> = { '/w/app/.ops/log/activity.jsonl': JSON.stringify(limitLine({})) }
  const toasts: string[] = []
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined as never } })
  on('tool.call', () => ({ result: 'ok' as never, text: 'ok' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  on('session.root', () => ({ value: '/w/app' }))
  on('session.repo', () => ({ value: { root: '/w/app', name: 'app', remote: null, internal: false } }))
  on('fs.read', (_$, e) => (lookup(files, e.path) === undefined ? { deny: 'ENOENT' } : { value: lookup(files, e.path) as string }))
  on('fs.stat', () => ({ deny: 'ENOENT' }))
  on('fs.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const r = await $.tool.call({ tool: 'Bash', tool_use_id: 'tl1', command: 'node /s/codex-delegate/scripts/relay.mjs --cd /w/app' } as never)
  expect(JSON.stringify(r)).toContain('ok')
  expect(toasts).toEqual(['Codex hit a rate limit 20 min ago (counted as limited for 40 more min); Claude is free to take it instead.'])
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tl2', command: 'node /s/agy-delegate/scripts/relay.mjs --cd /w/app' } as never)
  expect(toasts.length).toBe(1)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-delegations' })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('Codex hit a rate limit 20 min ago')
    expect(drawn.split('hit a rate limit').length).toBe(2)
    await ui.unmount()
  }
})

// The engine may hand fs hooks an absolute path in its own spelling: "/w/portal/x" can arrive
// as "D:/w/portal/x" on Windows, or resolved against the working folder elsewhere. Matching
// on the end of the normalised path keeps these tests the same on Windows, macOS and Linux.
const norm = (p: string) => p.split(String.fromCharCode(92)).join('/')
const lookup = (files: Record<string, string>, path: string) => {
  const key = Object.keys(files).find(k => norm(path).endsWith(k))
  return key === undefined ? undefined : files[key]
}

test('a relay command is tracked to its result.json and the tab shows it on both surfaces', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const root = '/w/portal'
  const files: Record<string, string> = { [root + '/brief.txt']: 'M0-007 Implement the budget band' + String.fromCharCode(10) + 'Details' }
  on('tool.call', () => ({ result: 'ok' as never, text: 'ok' }))
  on('session.start', () => ({ cwd: root }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  on('session.root', () => ({ value: root }))
  on('session.repo', () => ({ value: null }))
  on('fs.read', (_$, e) => (lookup(files, e.path) === undefined ? { deny: 'ENOENT' } : { value: lookup(files, e.path) as string }))
  on('fs.stat', (_$, e) => (lookup(files, e.path) === undefined ? { deny: 'ENOENT' } : { value: { kind: 'file' as const, size: 1, mtimeMs: 5000, isLink: false } }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: ' 3 files changed, 24 insertions(+), 24 deletions(-)', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu1', command: 'node /s/agy-delegate/scripts/relay.mjs --brief brief.txt --cd ' + root + ' --out-dir ' + root + '/out' } as never)
  const open = async (surface: 'terminal' | 'desktop') => {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-delegations' })
    return ui
  }
  const running = await open('terminal')
  const live = JSON.stringify(await running.drawn())
  expect(live).toContain('Implement the budget band')
  expect(live).toContain('Running 1')
  await running.unmount()
  files[root + '/out/result.json'] = JSON.stringify({ status: 'completed', finalMessage: 'Done, 42 tests passed' })
  await $.session.start({ cwd: root, surface: null, isInteractive: true })
  await clock.advance(5000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await open(surface)
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('Implement the budget band')
    expect(drawn).toContain('Review diff')
    await ui.unmount()
  }
})

test('an empty Delegations tab says nothing is delegated', { timeoutMs: 30_000 }, async ($, on) => {
  mock.clock(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-delegations' })
    expect(JSON.stringify(await ui.drawn()).includes('Nothing delegated')).toBe(true)
    await ui.unmount()
  }
})

test('a brief given as ~/… is read from the home folder', { timeoutMs: 30_000 }, async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/home/dev' })
  const files: Record<string, string> = { '/home/dev/briefs/m0-009.md': 'M0-009 Tidy the README' }
  on('tool.call', () => ({ result: 'ok' as never, text: 'ok' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  on('session.root', () => ({ value: '/w/portal' }))
  on('session.repo', () => ({ value: null }))
  on('fs.read', (_$, e) => (lookup(files, e.path) === undefined ? { deny: 'ENOENT' } : { value: lookup(files, e.path) as string }))
  on('fs.stat', () => ({ deny: 'ENOENT' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu9', command: 'node ~/.claude/skills/codex-delegate/scripts/relay.mjs --brief ~/briefs/m0-009.md --cd /w/portal' } as never)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-delegations' })
  expect(JSON.stringify(await ui.drawn())).toContain('Tidy the README')
  await ui.unmount()
})
