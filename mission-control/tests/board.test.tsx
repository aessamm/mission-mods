import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { activityLine, filterTickets, githubCacheOf, mcDirOfRunLog, parseActivity, parseFrontmatter, parseTicket, remoteIs, sectionsOf, staleNote, sourceTag } from '../hooks/features/board'
import { implementerOf, issueNumberOf, startBrief } from '../hooks/kit/brief'
import { resolveIn, samePath } from '../hooks/kit/paths'
import { DEFAULT_SETTINGS } from '../hooks/kit/state'

const PANE = {
  component: 'Pane' as const,
  requestId: 'mission-control',
  props: { title: 'Mission Control', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const START = { cwd: '/repo', surface: null, isInteractive: true }
const ticketSrc = (id: string, title: string, status: string, assignee = '') => `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\nassignee: ${assignee}\n---\n`

const SRC = `---
id: M0-007
title: "Delegations tab"   # shown on the board
status: in-progress
assignee: codex
estimate: M
---
## Context
x`

test('frontmatter and tickets parse; comments, quotes and odd status words are handled', () => {
  expect(parseFrontmatter(SRC).data.title).toBe('Delegations tab')
  const t = parseTicket(SRC, '.ops/tickets/M0/M0-007-x.md')!
  expect(t).toMatchObject({ id: 'M0-007', status: 'in_progress', assignee: 'codex', estimate: 'M' })
  expect(parseTicket('no frontmatter', 'notes.md')).toBeNull()
  expect(parseTicket('---\nstatus: nope\n---\n# Heading', 'M1-002-a.md')).toMatchObject({ id: 'M1-002', title: 'Heading', status: 'todo' })
})

test('activity skips bad lines and comes newest first; filters and sections split tickets', () => {
  const a = parseActivity('{"ts":"2026-10-09T10:00:00Z","actor":"claude","event":"a"}\nnot json\n{"event":"b"}\n')
  expect(a.map(x => x.event)).toEqual(['b', 'a'])
  const mk = (id: string, status: string, assignee?: string) => parseTicket(ticketSrc(id, id, status, assignee), `${id}.md`)!
  const list = [mk('A-1', 'blocked', 'agy'), mk('A-2', 'ready', 'claude'), mk('A-3', 'rework', 'codex'), mk('A-4', 'done')]
  expect(filterTickets(list, 'blocked').map(t => t.id)).toEqual(['A-1'])
  expect(filterTickets(list, 'mine').map(t => t.id)).toEqual(['A-2'])
  expect(filterTickets(list, 'agents').map(t => t.id)).toEqual(['A-1', 'A-3'])
  const s = sectionsOf(list)
  expect([s.todo.length, s.review.length, s.blocked.length, s.done.length]).toEqual([1, 1, 1, 1])
})

test('activity reads object details, GitHub issues and folds hook lines in a row', () => {
  const lines = [
    '{"ts":"2026-10-20T01:00:00Z","actor":"claude","ticket":"M0-109","event":"commit.landed","detail":{"sha":"e58fa33abc"},"ref":null}',
    '{"ts":"2026-10-20T02:00:00Z","actor":"claude","ticket":"M0-109","event":"ticket.status_changed","detail":{"from":"todo","to":"done"}}',
    '{"ts":"2026-10-20T03:00:00Z","actor":"claude","event":"session.started","session_id":"a","source":"hook","trigger":"startup"}',
    '{"ts":"2026-10-20T03:01:00Z","actor":"claude","event":"subagent.stopped","session_id":"a","agent_id":"x","source":"hook"}',
    '{"ts":"2026-10-20T03:02:00Z","actor":"claude","event":"session.started","session_id":"b","source":"hook"}',
    '{"ts":"2026-10-20T04:00:00Z","actor":"codex","ticket":null,"event":"run.completed","issue":28,"detail":{"agent":"codex","model":"gpt-6","durationSec":600,"touchedFiles":3},"source":"run-log"}',
    '{"ts":"2026-10-20T05:00:00Z","actor":"claude","event":"session.ended","source":"hook","reason":"exit"}',
    '{"ts":"2026-10-20T06:00:00Z","actor":"claude","event":"landed","ticket":"M0-201","commit":"a1595d7a","subject":"feat(web): Gen questions","backfill":true}',
  ].join('\n')
  const a = parseActivity(lines)
  expect(a.map(x => x.event)).toEqual(['landed', 'claude.sessions', 'run.completed', 'claude.sessions', 'ticket.status_changed', 'commit.landed'])
  expect(a[3]!.hooks).toEqual({ started: 2, ended: 0, subagents: 1 })
  expect(activityLine(a[3]!).text).toBe('Claude: 2 sessions started, 1 subagent stopped')
  expect(activityLine(a[2]!).text).toBe('#28 run completed: codex gpt-6 · 10 min · 3 files · codex')
  expect(activityLine(a[4]!).text).toBe('M0-109 ticket status changed to done · claude')
  expect(activityLine(a[5]!).text).toBe('M0-109 commit landed: e58fa33a · claude')
  expect(activityLine(a[0]!).text).toBe('M0-201 landed: feat(web): Gen questions · a1595d7a · claude')
})

test('the Board tab shows the empty state without .ops, on both surfaces', async ($, on) => {
  mock.clock(on)
  on('session.start', () => ({ cwd: START.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false } }))
  on('fs.exists', () => ({ value: false }))
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-board' })
    expect(JSON.stringify(await ui.drawn()).includes('No board in this project')).toBe(true)
    await ui.unmount()
  }
})

test('tickets and the activity log load from .ops and draw on both surfaces', async ($, on) => {
  mock.clock(on)
  on('session.start', () => ({ cwd: START.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  const file = (name: string) => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false } }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', (_$, e) => ({ value: e.path.endsWith('tickets') ? [file('M0-005.md'), file('M0-008.md'), file('TEMPLATE.md')] : [] }))
  on('fs.read', (_$, e) => ({
    value: e.path.endsWith('M0-005.md') ? ticketSrc('M0-005', 'RTL guard rules', 'in_review', 'agy')
      : e.path.endsWith('M0-008.md') ? ticketSrc('M0-008', 'Checkout keys', 'blocked')
        : e.path.endsWith('activity.jsonl') ? '{"ts":"2026-10-09T10:00:00Z","actor":"agy","ticket":"M0-005","event":"ticket.moved","to":"in_review"}\nbad\n' : '',
  }))
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-board' })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.includes('RTL guard rules')).toBe(true)
    expect(drawn.includes('Blocked · 1')).toBe(true)
    expect(drawn.includes('TEMPLATE')).toBe(false)
    await ui.unmount()
  }
})

const CACHE = JSON.stringify({
  schema: 'mc.github-tasks.v1', fetchedAt: '2026-10-20T04:50:00Z', repo: 'aessamm/mos',
  project: { owner: 'aessamm', number: 3, title: 'Agenca', url: 'https://github.com/users/aessamm/projects/3' },
  issues: [
    { number: 35, title: 'Daily production database backup', state: 'open', url: 'https://github.com/aessamm/mos/issues/35', labels: [{ name: 'type:ops' }, { name: 'priority:p1' }], assignees: [], status: 'In progress' },
    { number: 42, title: 'Paste the Meta app secret', state: 'open', labels: [{ name: 'owner-action' }], assignees: [{ login: 'aessamm' }], status: 'Waiting on owner' },
    { number: 44, title: 'Blocked on DNS', state: 'open', labels: [{ name: 'blocked' }], assignees: [], status: 'Todo' },
    { number: 47, title: 'New card', state: 'open', labels: [], assignees: [], status: null },
    { number: 20, title: 'Old one', state: 'closed', labels: [], assignees: [], status: 'Review' },
    { title: 'no number' },
  ],
})

test('GitHub issues from Mission Control’s cache become tickets in the board’s columns', () => {
  const g = githubCacheOf(JSON.parse(CACHE))!
  expect(g).toMatchObject({ repo: 'aessamm/mos', board: 'Agenca #3', url: 'https://github.com/users/aessamm/projects/3' })
  expect(g.tickets.map(t => [t.id, t.status])).toEqual([['#35', 'in_progress'], ['#42', 'waiting'], ['#44', 'blocked'], ['#47', 'todo'], ['#20', 'done']])
  expect(g.tickets[0]).toMatchObject({ labels: ['ops', 'p1'], url: 'https://github.com/aessamm/mos/issues/35' })
  expect(g.tickets[1]).toMatchObject({ assignee: 'aessamm' })
  expect(g.tickets[1]!.labels).toBeUndefined()
  const s = sectionsOf(g.tickets)
  expect([s.doing.length, s.waiting.length, s.blocked.length, s.todo.length, s.done.length]).toEqual([1, 1, 1, 1, 1])
  expect(githubCacheOf({ repo: 'x' })).toBeNull()
  const snap = { root: '/r', project: 'app', tickets: [], activity: [], readAt: 0, source: { kind: 'github' as const, repo: 'aessamm/mos', board: 'Agenca #3', fetchedAt: Date.parse('2026-10-20T04:50:00Z') } }
  expect(sourceTag(snap)).toBe('aessamm/mos · Agenca #3')
  expect(sourceTag({ ...snap, source: { kind: 'ops' } })).toBe('.ops/tickets')
  expect(staleNote(snap, Date.parse('2026-10-20T04:55:00Z'))).toBe('')
  expect(staleNote(snap, Date.parse('2026-10-20T07:00:00Z'))).toBe('cached 2h ago')
})

test('a cache counts only for its own repo; MC_RUN_LOG names Mission Control’s folder', () => {
  expect(remoteIs('https://github.com/aessamm/mos.git', 'aessamm/mos')).toBe(true)
  expect(remoteIs('git@github.com:AessamM/mos.git', 'aessamm/mos')).toBe(true)
  expect(remoteIs('https://github.com/aessamm/mission-mods.git', 'aessamm/mos')).toBe(false)
  expect(remoteIs('https://github.com/x/aessamm/mos2', 'aessamm/mos')).toBe(false)
  expect(mcDirOfRunLog('D:\\w\\mission-control\\scripts\\run-log.mjs')).toBe('D:/w/mission-control')
  expect(mcDirOfRunLog('/x/other.mjs')).toBe('')
  expect(resolveIn('D:/w/mission-control', '../app')).toBe('D:/w/app')
  expect(resolveIn('/w/mc', './a/../b')).toBe('/w/mc/b')
  expect(samePath('D:/W/App', 'd:\\w\\app\\')).toBe(true)
  expect(samePath('/w/App', '/w/app')).toBe(false)
})

// The test host resolves paths against its own drive, so mocks match on the tail only.
const tail = (p: string) => p.replace(/\\/g, '/')
async function boardWith($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], remote: string | null, extra: Record<string, string> = {}) {
  const ui = await (await startBoard($, on, remote, extra))('desktop')
  const drawn = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return drawn
}
// Registers the mocks, starts the session, and answers a function that mounts the Board tab.
async function startBoard($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], remote: string | null, extra: Record<string, string> = {}) {
  mock.clock(on)
  on('session.start', () => ({ cwd: '/w/app' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  const file = (name: string) => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })
  on('session.repo', () => ({ value: { root: '/w/app', name: 'app', remote, internal: false } }))
  on('fs.exists', (_$, e) => ({ value: tail(e.path).endsWith('/w/app/.ops/tickets') }))
  on('fs.list', (_$, e) => ({ value: tail(e.path).endsWith('/w/app/.ops/tickets') ? [file('M0-001.md')] : [] }))
  const files: Record<string, string> = { '/w/mission-control/.cache/github-tasks.json': CACHE, '/w/app/.ops/tickets/M0-001.md': ticketSrc('M0-001', 'Old ops ticket', 'done'), ...extra }
  on('fs.read', (_$, e) => {
    const hit = Object.keys(files).find(k => tail(e.path).endsWith(k))
    return hit ? { value: files[hit]! } : { deny: 'ENOENT' }
  })
  await $.session.start({ ...START, cwd: '/w/app' })
  return async (surface: 'terminal' | 'desktop') => {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-board' })
    return ui
  }
}

test('the board draws GitHub issues when the cache beside the repo is this repo’s', async ($, on) => {
  const drawn = await boardWith($, on, 'https://github.com/aessamm/mos.git')
  expect(drawn.includes('Daily production database backup')).toBe(true)
  expect(drawn.includes('Waiting on owner · 1')).toBe(true)
  expect(drawn.includes('aessamm/mos · Agenca #3')).toBe(true)
  expect(drawn.includes('Old ops ticket')).toBe(false)
})

test('another repo’s cache is ignored and the board falls back to .ops/tickets', async ($, on) => {
  const drawn = await boardWith($, on, 'https://github.com/someone/else.git')
  expect(drawn.includes('Daily production database backup')).toBe(false)
  expect(drawn.includes('.ops/tickets')).toBe(true)
})

test('with no remote, the cache counts when mc.config.json points its appDir at the repo', async ($, on) => {
  const drawn = await boardWith($, on, null, { '/w/mission-control/mc.config.json': '{"appDir":"../app"}' })
  expect(drawn.includes('Daily production database backup')).toBe(true)
})

const ROUTED = { ...DEFAULT_SETTINGS.routing, byRole: { builder: { model: 'claude-sonnet-5-5', effort: 'high' } } }

test('the Start brief names the ticket, its labels and URL, the implementer and the run-log wrap', () => {
  const [gh, , , todo] = githubCacheOf(JSON.parse(CACHE))!.tickets
  expect(implementerOf(DEFAULT_SETTINGS.routing)).toEqual({ agent: 'codex', name: 'Codex', skill: 'codex-delegate' })
  expect(implementerOf({ ...DEFAULT_SETTINGS.routing, byRole: { builder: { model: 'default', effort: 'low' } } })).toMatchObject({ agent: 'codex', effort: 'low' })
  expect(implementerOf(ROUTED)).toEqual({ agent: 'claude', name: 'Claude', skill: 'claude-delegate', model: 'claude-sonnet-5-5', effort: 'high' })
  expect(issueNumberOf(gh!)).toBe(35)

  const b = startBrief(gh!, DEFAULT_SETTINGS.routing)
  expect(b.split('\n')[0]).toBe('Delegate GitHub issue #35 "Daily production database backup" to Codex with /codex-delegate.')
  expect(b).toContain('Issue: https://github.com/aessamm/mos/issues/35')
  expect(b).toContain('Labels: ops, p1')
  expect(b).toContain('If MC_RUN_LOG is set')
  expect(b).toContain('node "$MC_RUN_LOG" start --agent codex --issue 35`')
  expect(b).toContain('node "$MC_RUN_LOG" end --agent codex --issue 35 --result auto')

  const r = startBrief(gh!, ROUTED)
  expect(r.split('\n')[0]).toBe('Delegate GitHub issue #35 "Daily production database backup" to Claude with /claude-delegate (model claude-sonnet-5-5, effort high).')
  expect(r).toContain('start --agent claude --issue 35 --model claude-sonnet-5-5 --effort high')
  expect(startBrief(todo!, DEFAULT_SETTINGS.routing)).not.toContain('Labels:')

  const ops = startBrief(parseTicket(ticketSrc('M0-007', 'Delegations tab', 'todo'), '.ops/tickets/M0/M0-007.md')!, DEFAULT_SETTINGS.routing)
  expect(ops).toContain('Delegate ticket M0-007 "Delegations tab" to Codex')
  expect(ops).toContain('Read .ops/tickets/M0/M0-007.md for the full brief')
  expect(ops).not.toContain('MC_RUN_LOG')
  expect(ops).not.toContain('Issue:')
})

test('picking a GitHub issue shows Start and Open on both surfaces; Start fills the composer', async ($, on) => {
  const filled: string[] = []
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true } })
  on('store.get', (_$, e) => ({ value: e.key === 'settings' ? { ...DEFAULT_SETTINGS, routing: ROUTED } : undefined }))
  on('store.set', () => ({ value: undefined as never }))
  const mount = await startBoard($, on, 'https://github.com/aessamm/mos.git')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount(surface)
    let drawn = JSON.stringify(await ui.drawn())
    expect(drawn.includes('"pick-#35"')).toBe(true)
    expect(drawn.includes('"pick-#20"')).toBe(false) // done: no actions
    expect(drawn.includes('"start-#35"')).toBe(false)
    await ui.press({ key: 'pick-#35' })
    drawn = JSON.stringify(await ui.drawn())
    expect(drawn.includes('"start-#35"')).toBe(true)
    expect(drawn.includes('https://github.com/aessamm/mos/issues/35')).toBe(true)
    await ui.press({ key: 'start-#35' })
    expect(filled.at(-1)!.split('\n')[0]).toContain('to Claude with /claude-delegate (model claude-sonnet-5-5, effort high)')
    await ui.press({ key: 'pick-#35' })
    expect(JSON.stringify(await ui.drawn()).includes('"start-#35"')).toBe(false)
    await ui.unmount()
  }
})

test('an .ops ticket gets Start but no Open', async ($, on) => {
  const filled: string[] = []
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true } })
  const ui = await (await startBoard($, on, null, { '/w/app/.ops/tickets/M0-001.md': ticketSrc('M0-001', 'Ops ticket', 'todo') }))('desktop')
  await ui.press({ key: 'pick-M0-001' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn.includes('"start-M0-001"')).toBe(true)
  expect(drawn.includes('"open-M0-001"')).toBe(false)
  await ui.press({ key: 'start-M0-001' })
  expect(filled.at(-1)).toContain('Delegate ticket M0-001 "Ops ticket" to Codex with /codex-delegate.')
  await ui.unmount()
})
