import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { daysOf, fallbackWeekly, parseWeekly, weeklyDoc, weeklyFacts, weeklyMarkdown, weeklyPrompt, windowDays } from '../hooks/features/weekly'
import type { ActivityEvent, DayLog, Ticket } from '../types'

// Noon UTC, so the local days below hold in any time zone the tests run in.
const NOW = Date.parse('2026-10-22T12:00:00Z')
const DAY = 86_400_000
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString()
const t = (id: string, title: string, status: Ticket['status']): Ticket => ({ id, title, status, path: id })

const TICKETS: Ticket[] = [
  t('#35', 'Daily database backup', 'done'),
  t('#20', 'Old login page', 'done'),            // done, but nothing this week names it
  t('#41', 'Invoice export', 'done'),            // closed this week per the activity log
  t('#42', 'Paste the Meta app secret', 'waiting'),
  t('#47', 'Search filters', 'in_progress'),
  t('#48', 'Arabic receipts', 'in_review'),
  t('#50', 'New card', 'todo'),
]
const ACTIVITY: ActivityEvent[] = [
  { ts: iso(2), actor: 'claude', event: 'ticket.status_changed', issue: 41, to: 'done' },
  { ts: iso(30), actor: 'claude', event: 'ticket.status_changed', issue: 20, to: 'done' },
]
const COMMITS = ['abc1234 feat: daily backup check (#35, M0-001)', 'def5678 fix: header colour']
const ticket = (id: string, title: string, status: string) => `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\n---\n`
// The test host resolves paths against its own drive, so mocks match on the tail only.
const tail = (p: string) => p.replace(/\\/g, '/')
const day = (d: string, text: string): DayLog => ({ day: d, entries: [{ at: 0, project: 'app', kind: 'agent', text }, { at: 0, project: 'app', kind: 'session', text: 'x' }], sessions: 1, agents: 1, spentUsd: 0 })

test('the week\'s facts: closed, in progress, waiting, commits and the day logs', () => {
  expect(daysOf('')).toBe(7)
  expect(daysOf(' 14 ')).toBe(14)
  expect(daysOf('0')).toBe(7)
  expect(daysOf('lots')).toBe(7)
  const days = windowDays(NOW, 7)
  expect(days.length).toBe(7)
  expect(days[6]).toBe(windowDays(NOW, 1)[0])
  const f = weeklyFacts(7, NOW, TICKETS, ACTIVITY, COMMITS, [day(days[0]!, 'Scout mapped the API'), day('2026-01-01', 'too old')])
  expect(f.closed.map(i => i.id)).toEqual(['#35', '#41'])
  expect(f.inProgress.map(i => i.id)).toEqual(['#47', '#48'])
  expect(f.waiting).toEqual([{ id: '#42', title: 'Paste the Meta app secret' }])
  expect(f.commits).toEqual(['feat: daily backup check (#35, M0-001)', 'fix: header colour'])
  expect(f.notes).toEqual([`${days[0]} app: Scout mapped the API`])
  const p = weeklyPrompt(f)
  expect(p.includes('Finished this week (2):\n- Daily database backup\n- Invoice export')).toBe(true)
  expect(p.includes('no ticket or issue ids')).toBe(true)
  expect(p.includes('- #35')).toBe(false)
})

test('the model reply parses defensively; the fallback names titles but no ids', () => {
  expect(parseWeekly('```json\n{"title":"Week 43","clientAr":"أنجزنا","clientEn":"We finished"}\n```')).toEqual({ title: 'Week 43', clientAr: 'أنجزنا', clientEn: 'We finished' })
  expect(parseWeekly('{"title":"T","clientEn":"e"}')).toBeUndefined()
  expect(parseWeekly('sorry')).toBeUndefined()
  const f = weeklyFacts(7, NOW, TICKETS, ACTIVITY, COMMITS, [])
  const d = fallbackWeekly(f)
  expect(d.clientEn.includes('we completed 2 items:\n- Daily database backup\n- Invoice export')).toBe(true)
  expect(d.clientEn.includes('Waiting on you (1):\n- Paste the Meta app secret')).toBe(true)
  expect(d.clientAr.includes('بانتظار ردّك (1):')).toBe(true)
  expect(/#\d/.test(d.clientEn + d.clientAr)).toBe(false)
  const doc = weeklyDoc(f, d, NOW, false)
  expect(doc.kind).toBe('weekly')
  expect(doc.extra).toMatchObject({ closed: '2', inProgress: '2', waiting: '1', commits: '2', lang: 'ar', drafted: 'plain' })
  expect(weeklyMarkdown(doc, 'en').startsWith(`# ${d.title}\n\nThis week`)).toBe(true)
  expect(weeklyMarkdown(doc, 'ar').includes('خلال هذا الأسبوع')).toBe(true)
  // A quiet week still reads as a sentence.
  expect(fallbackWeekly(weeklyFacts(7, NOW, [], [], [], [])).clientEn.includes('we completed 0 changes.')).toBe(true)
})

async function weekly($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], reply: string) {
  mock.clock(on, { now: NOW })
  const asked: string[] = []
  const days = windowDays(NOW, 7)
  on('store.get', (_$, e) => ({ value: e.key === `log:${days[3]}` ? day(days[3]!, 'Builder finished the export') : undefined }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false } }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_$, e) => {
    asked.push(e.argv.join(' '))
    return { value: { exitCode: 0, stdout: COMMITS.join('\n'), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('model.complete', (_$, e) => {
    asked.push(e.prompt)
    return { value: { isAnswered: true as const, text: reply, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  // The board loads at session start from .ops: tickets and the activity log.
  const ops: Record<string, string> = {
    'M0-001.md': ticket('M0-001', 'Daily database backup', 'done'),
    'M0-002.md': ticket('M0-002', 'Invoice export', 'done'),
    'M0-003.md': ticket('M0-003', 'Paste the Meta app secret', 'waiting_on_owner'),
    'M0-004.md': ticket('M0-004', 'Search filters', 'in_progress'),
  }
  const file = (name: string) => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })
  on('session.start', () => ({ cwd: '/repo' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  on('fs.exists', (_$, e) => ({ value: tail(e.path).endsWith('/repo/.ops/tickets') }))
  on('fs.list', (_$, e) => ({ value: tail(e.path).endsWith('/repo/.ops/tickets') ? Object.keys(ops).map(file) : [] }))
  on('fs.read', (_$, e) => {
    const p = tail(e.path)
    const hit = Object.keys(ops).find(k => p.endsWith(`/.ops/tickets/${k}`))
    return hit ? { value: ops[hit]! }
      : p.endsWith('/.ops/log/activity.jsonl') ? { value: JSON.stringify({ ts: iso(2), actor: 'claude', ticket: 'M0-002', event: 'ticket.status_changed', to: 'done' }) }
        : { deny: 'ENOENT' }
  })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
  const r = await $.command.run({ command: 'weekly', args: '' })
  return { r, asked }
}

test('/weekly reads git and the day logs, and falls back when the reply is not JSON', { timeoutMs: 30_000 }, async ($, on) => {
  const { r, asked } = await weekly($, on, 'not json')
  expect(asked.some(a => a.startsWith('git log --oneline --no-merges') && a.includes('--since=7 days ago'))).toBe(true)
  expect(asked.some(a => a.includes('Builder finished the export'))).toBe(true)
  expect(r.text?.includes('we completed 2 items:')).toBe(true)
  expect(r.text?.includes('خلال هذا الأسبوع')).toBe(true)
  expect(r.context?.some(c => c.includes('plain draft'))).toBe(true)
})

test('the /weekly card draws on both surfaces and switches between Arabic and English', { timeoutMs: 30_000 }, async ($, on) => {
  await weekly($, on, '{"title":"Week 43","clientAr":"أنجزنا النسخ الاحتياطي","clientEn":"We finished the daily backup."}')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, component: 'CommandOutput', props: { command: 'weekly', args: '', text: 'x', isErrored: false } })
    const drawn = async () => JSON.stringify(await ui.drawn())
    expect((await drawn()).includes('/weekly  Week 43')).toBe(true)
    expect((await drawn()).includes('أنجزنا النسخ الاحتياطي')).toBe(true)
    expect((await drawn()).includes('Copy')).toBe(true)
    expect((await drawn()).includes('2 finished items · 1 in progress · 1 waiting on the client')).toBe(true)
    await ui.press({ key: 'lang-en' })
    expect((await drawn()).includes('We finished the daily backup.')).toBe(true)
    expect((await drawn()).includes('أنجزنا النسخ الاحتياطي')).toBe(false)
    await ui.press({ key: 'lang-ar' })
    await ui.unmount()
  }
})
