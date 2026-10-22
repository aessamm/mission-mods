import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { BoardSnapshot, Delegation } from '../types'
import { inboxItems, inboxSummary, issuePrompt, toastFor } from '../hooks/features/inbox'
import { promptFor } from '../hooks/features/delegations'

const PANE = {
  component: 'Pane' as const,
  requestId: 'mission-control',
  props: { title: 'Mission Control', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
}

const ticket = (id: string, title: string, status: BoardSnapshot['tickets'][number]['status']) => ({ id, title, status, path: '' })
const snapOf = (tickets: BoardSnapshot['tickets']): BoardSnapshot => ({
  root: '/w/app', project: 'app', tickets, activity: [], readAt: 0,
  source: { kind: 'github', repo: 'ahmed/app', fetchedAt: 0 },
})
const run = (id: string, status: Delegation['status'], task: string, endedAt: number): Delegation => ({
  id, tool: 'codex', task, project: 'app', cwd: '/w/app', branch: `fix/${id}`, startedAt: 0, endedAt, status, now: '', ticket: `#${id}`,
})

test('the inbox lists owner issues, failed runs and reviews, and words its toast', () => {
  const snap = snapOf([ticket('#42', 'Add the Play Console key', 'waiting'), ticket('#43', 'Wire the band', 'in_progress')])
  const runs = { a: run('a', 'review', 'Fix RTL', 10), b: run('b', 'failed', 'Port the job', 20), c: run('c', 'running', 'Busy', 0) }
  const items = inboxItems(snap, runs)
  expect(items.map(i => i.key)).toEqual(['issue:#42', 'failed:b', 'review:a'])
  expect(items[0]!.prompt).toBe('Help me with #42 Add the Play Console key: tell me exactly what I need to do')
  expect(issuePrompt('#7', 'x')).toBe('Help me with #7 x: tell me exactly what I need to do')
  expect(items[2]!.prompt).toBe(promptFor('review', runs.a))
  expect(items[1]!.prompt).toBe(promptFor('fix', runs.b))
  expect(inboxSummary(items)).toBe('1 owner issue · 1 to review · 1 failed')
  expect(inboxItems(null, {})).toEqual([])

  const told = new Set<string>()
  expect(toastFor(items, told)).toContain('1 GitHub issue in Waiting on owner')
  told.add('issue:#42')
  expect(toastFor(items, told)).toBeUndefined()
  const more = inboxItems(snapOf([...snap.tickets, ticket('#50', 'Approve the DNS change', 'waiting')]), {})
  expect(toastFor(more, told)).toBe('New on Waiting on owner: #50 Approve the DNS change')
})

// The board and delegation features fill the atoms the inbox reads; these tests feed them the
// way a session does: Mission Control's GitHub cache beside the repo, and a relay run that
// finishes into its result.json. The test host resolves paths on its own drive, so mocks
// match on the tail.
const tail = (p: string) => p.replace(/\\/g, '/')
const issue = (number: number, title: string, status: string) => ({ number, title, state: 'open', labels: [], assignees: [], status })
const cacheOf = (issues: object[]) => JSON.stringify({ schema: 'mc.github-tasks.v1', fetchedAt: '2026-10-20T04:50:00Z', repo: 'ahmed/app', issues })
const CACHE = '/w/mission-control/.cache/github-tasks.json'
const TWO = [issue(42, 'Add the Play Console key', 'Waiting on owner'), issue(50, 'Approve the DNS change', 'Waiting on owner')]
// UI tests draw the whole panel and band; give them room on a busy machine.
const WITH = { timeoutMs: 30_000 }

async function setup($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], opts: { run?: boolean } = {}) {
  const clock = mock.clock(on, { now: 1000 })
  const toasts: string[] = []
  const filled: string[] = []
  const files: Record<string, string> = {
    [CACHE]: cacheOf([issue(42, 'Add the Play Console key', 'Waiting on owner'), issue(43, 'Wire the band', 'In progress')]),
    '/w/app/brief.txt': 'Fix RTL classes',
  }
  const find = (path: string) => Object.keys(files).find(k => tail(path).endsWith(k))
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined as never } })
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  on('tool.call', () => ({ result: 'ok' as never, text: 'ok' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 10, tokens: 100_000 }, cost: { usd: 0 }, rateLimits: [] } }))
  on('session.turns', () => ({ value: 1 }))
  on('session.id', () => ({ value: 'test-session' }))
  on('session.cwd', () => ({ value: '/w/app' }))
  on('session.root', () => ({ value: '/w/app' }))
  on('session.repo', () => ({ value: { root: '/w/app', name: 'app', remote: 'https://github.com/ahmed/app.git', internal: false } }))
  const kept = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_$, e) => { kept.set(e.key, e.value); return { value: undefined as never } })
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_$, e) => { const k = find(e.path); return k ? { value: files[k]! } : { deny: 'ENOENT' } })
  on('fs.stat', (_$, e) => (find(e.path) ? { value: { kind: 'file' as const, size: 1, mtimeMs: 5000, isLink: false } } : { deny: 'ENOENT' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: ' 3 files changed, 24 insertions(+), 24 deletions(-)', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  // The engine's own band.
  on('ui.render', { component: 'AbovePrompt' }, ($$, e) => { const { Text } = $$.ui.resolve(e); return <Text>engine band</Text> })
  if (opts.run) {
    await $.tool.call({ tool: 'Bash', tool_use_id: 'tu1', command: 'node /s/agy-delegate/scripts/relay.mjs --brief brief.txt --cd /w/app --out-dir /w/app/out' } as never)
    files['/w/app/out/result.json'] = JSON.stringify({ status: 'completed', finalMessage: 'Done, 42 tests passed' })
  }
  await $.session.start({ cwd: '/w/app', surface: null, isInteractive: true })
  await clock.advance(5000)
  return { clock, toasts, filled, files }
}

const band = async ($: Parameters<TestBody>[0], surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...BAND })
  return { ui, drawn: JSON.stringify(await ui.drawn()) }
}

test('the band shows what waits on the person beneath the status line, and its buttons fill the composer', WITH, async ($, on) => {
  const { filled } = await setup($, on, { run: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const { ui, drawn } = await band($, surface)
    expect(drawn).toContain('Waiting on you')
    expect(drawn).toContain('1 owner issue · 1 to review')
    expect(drawn).toContain('Add the Play Console key')
    expect(drawn).toContain('Fix RTL classes')
    expect(drawn).not.toContain('Wire the band')
    // One band: on desktop the status line draws first; on the terminal, what is beneath.
    expect(drawn).toContain(surface === 'desktop' ? 'Context' : 'engine band')
    await ui.press({ key: 'inbox-go-issue:#42' })
    await ui.press({ key: 'inbox-go-review:tu1' })
    await ui.unmount()
  }
  expect(filled).toContain('Help me with #42 Add the Play Console key: tell me exactly what I need to do')
  expect(filled.some(t => t.startsWith('Review the diff from') && t.includes('/w/app'))).toBe(true)
})

test('Hide puts the rows away until something new joins; Settings › Panel turns the inbox off', WITH, async ($, on) => {
  const { clock, files } = await setup($, on)
  let b = await band($)
  expect(b.drawn).toContain('Waiting on you')
  await b.ui.press({ key: 'inbox-hide' })
  expect(JSON.stringify(await b.ui.drawn())).not.toContain('Waiting on you')
  await b.ui.unmount()
  files[CACHE] = cacheOf(TWO)
  await clock.advance(30_000)
  b = await band($)
  expect(b.drawn).toContain('Approve the DNS change')
  expect(b.drawn).toContain('2 owner issues')
  await b.ui.unmount()

  const pane = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE })
  await pane.press({ key: 'tab-settings' })
  expect(JSON.stringify(await pane.drawn())).toContain('Waiting on you')
  await pane.press({ key: 'show-inbox-off' })
  await pane.unmount()
  b = await band($)
  expect(b.drawn).not.toContain('Waiting on you')
  await b.ui.unmount()
})

test('a toast once per session for owner issues, and again when a new one appears', WITH, async ($, on) => {
  const { clock, toasts, files } = await setup($, on)
  await clock.advance(5000)
  const mine = () => toasts.filter(t => t.includes('Waiting on owner'))
  expect(mine()).toEqual(['Waiting on you: 1 GitHub issue in Waiting on owner. See the line above the prompt.'])
  files[CACHE] = cacheOf(TWO)
  await clock.advance(30_000)
  await clock.advance(5000)
  expect(mine().length).toBe(2)
  expect(mine()[1]).toBe('New on Waiting on owner: #50 Approve the DNS change')
})
