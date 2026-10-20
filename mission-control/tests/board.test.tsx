import { expect, mock, test } from 'claude-code/testing'

import { activityLine, filterTickets, parseActivity, parseFrontmatter, parseTicket, sectionsOf } from '../hooks/features/board'

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
