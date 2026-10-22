// Weekly client update: /weekly [days] gathers the week read-only (the board's GitHub issues or
// .ops tickets, the commits since then, the day logs), asks the model for a client update in
// Arabic and English, stores it as the lastDoc atom and draws it as a card in the transcript
// with a language switch and Copy. Nothing is sent anywhere and nothing in the repo changes.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { ActivityEvent, BoardSnapshot, CommandDoc, DayLog, Ticket } from '../../types'
import { STORE, localDay } from '../kit/state'
import { dayOf } from './log'

const lastDoc = atom({ plugin: 'mission-control', key: 'lastDoc' } as const, null as CommandDoc | null)
const board = atom({ plugin: 'mission-control', key: 'board' } as const, null as BoardSnapshot | null)
const log = atom({ plugin: 'mission-control', key: 'log' } as const, null as DayLog | null)

const MODEL = 'claude-sonnet-5-5'
const DAY_MS = 86_400_000
const MAX_COMMITS = 80
const MAX_NOTES = 30

export type WeeklyItem = { id: string; title: string }
export type WeeklyFacts = {
  days: number
  from: string               // YYYY-MM-DD, local, the window's first day
  to: string                 // YYYY-MM-DD, local, today
  closed: WeeklyItem[]       // done, and named by a commit or the activity log in the window
  inProgress: WeeklyItem[]   // doing, review or rework
  waiting: WeeklyItem[]      // waiting on the owner or the client
  commits: string[]          // subjects, newest first
  notes: string[]            // day-log lines of the window, oldest first
}
export type WeeklyDraft = { title: string; clientAr: string; clientEn: string }
export type WeeklyLang = 'ar' | 'en'

// ---------------------------------------------------------------- pure helpers
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// "/weekly 14" → 14; nothing, or anything that is not 1 to 90, → 7.
export function daysOf(arg: string): number {
  const n = Number(arg.trim().split(/\s+/)[0])
  return Number.isInteger(n) && n >= 1 && n <= 90 ? n : 7
}

// The window's days, oldest first, ending today.
export const windowDays = (now: number, days: number): string[] =>
  Array.from({ length: days }, (_, i) => localDay(now - (days - 1 - i) * DAY_MS))

const subjectOf = (line: string) => line.replace(/^[0-9a-f]{6,40}\s+/, '').trim()
const idsIn = (s: string): string[] => [...s.matchAll(/(?:^|[\s(,])(#\d{1,7}|[A-Za-z][\w]*-\d+)\b/g)].map(m => m[1]!)

// What the board and the week's commits and activity say. A done ticket counts as closed this
// week when a commit in the window or an activity line since `fromMs` names it.
export function weeklyFacts(days: number, now: number, tickets: Ticket[], activity: ActivityEvent[], commits: string[], logs: DayLog[]): WeeklyFacts {
  const list = windowDays(now, days)
  const fromMs = now - days * DAY_MS
  const named = new Set<string>()
  for (const c of commits) for (const id of idsIn(subjectOf(c))) named.add(id)
  for (const a of activity) {
    const at = Date.parse(a.ts)
    if (!Number.isFinite(at) || at < fromMs) continue
    if (a.issue) named.add(`#${a.issue}`)
    if (a.ticket) named.add(a.ticket)
  }
  const item = (t: Ticket): WeeklyItem => ({ id: t.id, title: t.title })
  return {
    days, from: list[0] ?? '', to: list[list.length - 1] ?? '',
    closed: tickets.filter(t => t.status === 'done' && named.has(t.id)).map(item),
    inProgress: tickets.filter(t => t.status === 'in_progress' || t.status === 'in_review' || t.status === 'rework').map(item),
    waiting: tickets.filter(t => t.status === 'waiting').map(item),
    commits: commits.map(subjectOf).filter(Boolean),
    notes: logs.filter(d => list.includes(d.day)).flatMap(d => d.entries.filter(e => e.kind !== 'session').map(e => `${d.day} ${e.project}: ${e.text}`)).slice(-MAX_NOTES),
  }
}

// Tolerates code fences and prose around the JSON; returns undefined when it is not usable.
export function parseWeekly(raw: string): WeeklyDraft | undefined {
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}')
  if (a < 0 || b <= a) return undefined
  try {
    const o = JSON.parse(raw.slice(a, b + 1)) as Record<string, unknown>
    const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '')
    const d = { title: str('title'), clientAr: str('clientAr'), clientEn: str('clientEn') }
    return d.title && d.clientAr && d.clientEn ? d : undefined
  } catch {
    return undefined
  }
}

const bullets = (list: WeeklyItem[], max = 8) => list.slice(0, max).map(i => `- ${i.title}`).concat(list.length > max ? [`- …`] : [])

// A plain update from the counts and titles alone, when the model's reply is not usable.
export function fallbackWeekly(f: WeeklyFacts): WeeklyDraft {
  const done = f.closed.length || f.commits.length
  const en = [
    `This week (${f.from} to ${f.to}) we completed ${plural(done, f.closed.length ? 'item' : 'change')}${f.closed.length ? ':' : '.'}`,
    ...bullets(f.closed),
    ...(f.inProgress.length ? ['', `${plural(f.inProgress.length, 'item is', 'items are')} in progress:`, ...bullets(f.inProgress)] : []),
    ...(f.waiting.length ? ['', `Waiting on you (${f.waiting.length}):`, ...bullets(f.waiting)] : []),
    '', 'We will share the next update at the end of next week.',
  ].join('\n')
  const ar = [
    `خلال هذا الأسبوع (من ${f.from} إلى ${f.to}) أنجزنا ${done} ${done === 1 ? 'مهمة' : 'مهام'}${f.closed.length ? ':' : '.'}`,
    ...bullets(f.closed),
    ...(f.inProgress.length ? ['', `قيد التنفيذ الآن (${f.inProgress.length}):`, ...bullets(f.inProgress)] : []),
    ...(f.waiting.length ? ['', `بانتظار ردّك (${f.waiting.length}):`, ...bullets(f.waiting)] : []),
    '', 'سنشاركك التحديث القادم في نهاية الأسبوع المقبل.',
  ].join('\n')
  return { title: `Weekly update, ${f.from} to ${f.to}`, clientAr: ar, clientEn: en }
}

export function weeklyPrompt(f: WeeklyFacts): string {
  const list = (head: string, items: string[]) => [`${head} (${items.length}):`, ...(items.length ? items : ['(none)']), '']
  return [
    `You are writing a weekly update for a client about a software project, covering ${f.from} to ${f.to}.`,
    'Reply with ONE JSON object and nothing else, with exactly these string keys:',
    '"title": a short title for the update,',
    '"clientAr": the update in Arabic, in markdown: a short opening line, then bullets for what was finished, what is in progress, and what waits on the client,',
    '"clientEn": the same update in English.',
    'Write for a non-technical reader: plain words, no code, no commit hashes, no ticket or issue ids such as #12 or M0-003.',
    'Use only the facts given. Do not invent features, numbers or dates.',
    '',
    ...list('Finished this week', f.closed.map(i => `- ${i.title}`)),
    ...list('In progress', f.inProgress.map(i => `- ${i.title}`)),
    ...list('Waiting on the client', f.waiting.map(i => `- ${i.title}`)),
    ...list('Commits this week', f.commits.slice(0, MAX_COMMITS).map(c => `- ${c}`)),
    ...list('Work log', f.notes.map(n => `- ${n}`)),
  ].join('\n')
}

const SECTIONS = ['Client update (Arabic)', 'Client update (English)']

export function weeklyDoc(f: WeeklyFacts, d: WeeklyDraft, at: number, isDrafted: boolean): CommandDoc {
  return {
    kind: 'weekly', at, title: d.title,
    sections: [d.clientAr, d.clientEn].map((text, i) => ({ heading: SECTIONS[i] ?? '', lines: text.split('\n') })),
    extra: {
      from: f.from, to: f.to, days: String(f.days),
      closed: String(f.closed.length), inProgress: String(f.inProgress.length), waiting: String(f.waiting.length), commits: String(f.commits.length),
      lang: 'ar', drafted: isDrafted ? 'model' : 'plain',
    },
  }
}

// The copy-ready markdown of one language.
export function weeklyMarkdown(doc: CommandDoc, lang: WeeklyLang): string {
  return [`# ${doc.title}`, '', (doc.sections[lang === 'ar' ? 0 : 1]?.lines ?? []).join('\n')].join('\n')
}

// ---------------------------------------------------------------- gathering (read-only)
async function gitLog($: EngineInterface, here: string, days: number): Promise<string[]> {
  try {
    const r = await $.process.run(['git', 'log', '--oneline', '--no-merges', `-n${MAX_COMMITS}`, `--since=${days} days ago`], { cwd: here, timeoutMs: 15000 })
    return r.exitCode === 0 ? r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

async function dayLogs($: EngineInterface, days: string[]): Promise<DayLog[]> {
  const today = await read($, log)
  const out: DayLog[] = []
  for (const day of days) {
    if (today && today.day === day) out.push(dayOf(today, day))
    else out.push(dayOf(await $.store.get(STORE.dayLog(day)).catch(() => null), day))
  }
  return out
}

// ---------------------------------------------------------------- hooks
export function registerWeekly(on: On): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'weekly', description: 'A client update for the week in Arabic and English, from the board, commits and day logs', argumentHint: '[days]' })
    return started
  })

  on('command.run', { command: 'weekly' }, async ($, e) => {
    const days = daysOf(String(e.args ?? ''))
    const now = await $.clock.now()
    const repo = await $.session.repo().catch(() => null)
    const here = await $.session.cwd().catch(() => repo?.root ?? '')
    const snap = await read($, board)
    const commits = repo ? await gitLog($, here, days) : []
    const facts = weeklyFacts(days, now, snap?.tickets ?? [], snap?.activity ?? [], commits, await dayLogs($, windowDays(now, days)))
    let draft: WeeklyDraft | undefined
    try {
      const r = await $.model.complete({ model: MODEL, prompt: weeklyPrompt(facts), maxTokens: 1600 })
      draft = r.isAnswered ? parseWeekly(r.text) : undefined
    } catch {
      draft = undefined
    }
    const doc = weeklyDoc(facts, draft ?? fallbackWeekly(facts), now, !!draft)
    await update($, lastDoc, () => doc)
    return {
      text: [weeklyMarkdown(doc, 'ar'), '', '---', '', weeklyMarkdown(doc, 'en')].join('\n'),
      context: [
        'The /weekly client update above is a draft for the person to review and send themselves. Nothing was sent. Do not send it or post it anywhere.',
        ...(draft ? [] : ['The model draft could not be read, so this is a plain draft built from the board, commits and day logs.']),
      ],
    }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'weekly' } }, async ($, e, next) => {
    const doc = await read($, lastDoc)
    if (!doc || doc.kind !== 'weekly') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const x = doc.extra ?? {}
    const lang: WeeklyLang = x.lang === 'en' ? 'en' : 'ar'
    const set = (l: WeeklyLang) => void update($, lastDoc, d => (d && d.kind === 'weekly' ? { ...d, extra: { ...d.extra, lang: l } } : d))
    const pill = (l: WeeklyLang, name: string) => (
      <Button key={`lang-${l}`} label={name} plain={lang !== l ? true : undefined} variant={lang === l ? 'primary' : undefined} onPress={() => set(l)} />
    )
    const md = weeklyMarkdown(doc, lang)
    return (
      <Box key="weekly-card" flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{`/weekly  ${doc.title}`}</Text>
          <Text dimColor>{`${x.from} to ${x.to} · ${plural(Number(x.closed ?? 0), 'finished item')} · ${Number(x.inProgress ?? 0)} in progress · ${Number(x.waiting ?? 0)} waiting on the client · ${plural(Number(x.commits ?? 0), 'commit')}${x.drafted === 'plain' ? ' · plain draft' : ''}`}</Text>
        </Box>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {pill('ar', 'العربية')}
          {pill('en', 'English')}
        </Box>
        <Text>{md}</Text>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="copy" label="Copy" variant="primary" onPress={press => void $.ui.copy({ text: md, surface: press.surface })} />
          <Text dimColor>Nothing is sent: copy it and send it yourself.</Text>
        </Box>
      </Box>
    )
  })
}
