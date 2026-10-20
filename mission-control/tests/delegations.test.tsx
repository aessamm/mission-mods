import { expect, mock, test } from 'claude-code/testing'

import type { Delegation } from '../types'
import { applyResult, fromRun, fromRunLog, parseRelay, parseShortstat, progressOf, promptFor, sameRun, taskOf, ticketOf } from '../hooks/features/delegations'


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

// The engine may hand fs hooks an absolute path in its own spelling: "/w/portal/x" can arrive
// as "D:/w/portal/x" on Windows, or resolved against the working folder elsewhere. Matching
// on the end of the normalised path keeps these tests the same on Windows, macOS and Linux.
const norm = (p: string) => p.split(String.fromCharCode(92)).join('/')
const lookup = (files: Record<string, string>, path: string) => {
  const key = Object.keys(files).find(k => norm(path).endsWith(k))
  return key === undefined ? undefined : files[key]
}

test('a relay command is tracked to its result.json and the tab shows it on both surfaces', async ($, on) => {
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

test('an empty Delegations tab says nothing is delegated', async ($, on) => {
  mock.clock(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-delegations' })
    expect(JSON.stringify(await ui.drawn()).includes('Nothing delegated')).toBe(true)
    await ui.unmount()
  }
})

test('a brief given as ~/… is read from the home folder', async ($, on) => {
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
