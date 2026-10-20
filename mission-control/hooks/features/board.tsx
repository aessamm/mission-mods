// Board: reads the .ops/ layer of the repo (tickets as Markdown with frontmatter, plus
// log/activity.jsonl) and draws the Board tab: progress, filters, Doing / Review /
// Blocked / To do, a collapsed Done, and the activity log.
import { atom, read, update } from 'claude-code'
import { failedView } from '../kit/ui'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { ActivityEvent, AgentRecord, AgentRunStats, BoardSnapshot, DecisionNote, Delegation, Settings, Ticket, TicketStatus } from '../../types'
import { fmtSpan } from '../kit/role'
import { mainCheckoutOf } from '../kit/paths'
import { emptyState } from '../kit/ui'
import { activeTab, badgesFrom, clip, tabBar } from '../kit/chrome'
import { barText, box, hline, iconInk, progress, svg, text, textWidth, wide } from '../kit/draw'
import { DEFAULT_PANEL, DEFAULT_SETTINGS, makeCtx, settingsOf } from '../kit/state'
import type { PaneInput } from '../kit/state'
import type { TabCtx } from '../kit/state'

const agents = atom({ plugin: 'mission-control', key: 'agents' } as const, {} as Record<string, AgentRecord>)
const board = atom({ plugin: 'mission-control', key: 'board' } as const, null as BoardSnapshot | null)
const delegations = atom({ plugin: 'mission-control', key: 'delegations' } as const, {} as Record<string, Delegation>)
const panel = atom({ plugin: 'mission-control', key: 'panel' } as const, DEFAULT_PANEL)
const settings = atom({ plugin: 'mission-control', key: 'settings' } as const, DEFAULT_SETTINGS)

const REFRESH_MS = 30_000
const MAX_TICKETS = 400
type Theme = 'follow' | 'light' | 'dark'
type Motion = 'full' | 'calm' | 'off'

// ---------------------------------------------------------------- pure parsing
const STATUS_WORDS: Record<string, TicketStatus> = {
  todo: 'todo', to_do: 'todo', backlog: 'todo', ready: 'ready', in_progress: 'in_progress', doing: 'in_progress', wip: 'in_progress',
  in_review: 'in_review', review: 'in_review', rework: 'rework', done: 'done', closed: 'done', merged: 'done', blocked: 'blocked',
}
export const statusOf = (raw: string | undefined): TicketStatus => STATUS_WORDS[(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? 'todo'

const unquote = (v: string): string => {
  const t = v.trim()
  if (t.startsWith('"') || t.startsWith("'")) {
    const q = t[0]!
    const end = t.indexOf(q, 1)
    return end > 0 ? t.slice(1, end) : t.slice(1)
  }
  const hash = t.search(/(^|\s)#/)
  return (hash >= 0 ? t.slice(0, hash) : t).trim()
}

// The `key: value` lines between the first two `---` lines. No YAML library: lists and
// nested values stay as their raw text, which is all the board needs.
export function parseFrontmatter(src: string): { data: Record<string, string>; body: string } {
  const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { data: {}, body: src }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (end < 0) return { data: {}, body: src }
  const data: Record<string, string> = {}
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line)
    if (m) data[m[1]!] = unquote(m[2]!)
  }
  return { data, body: lines.slice(end + 1).join('\n') }
}

export function parseTicket(src: string, path: string): Ticket | null {
  const { data, body } = parseFrontmatter(src)
  const stem = (path.split(/[\\/]/).pop() ?? path).replace(/\.md$/i, '')
  const id = data.id || /^[A-Za-z][\w]*-\d+/.exec(stem)?.[0] || ''
  if (!id) return null
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim()
  const pick = (k: string) => data[k] || undefined
  const deps = idsIn(data.depends_on ?? '')
  return {
    id, title: data.title || heading || stem, status: statusOf(data.status), path,
    assignee: pick('assignee'), milestone: pick('milestone'), epic: pick('epic'), tier: pick('tier'), estimate: pick('estimate'),
    ...(deps.length ? { dependsOn: deps } : {}), ...(pick('model') ? { model: pick('model') } : {}),
  }
}

// Ticket ids in a frontmatter list: "[M0-003, M0-004]" or "M0-003, M0-004".
export const idsIn = (raw: string): string[] => [...new Set(raw.match(/\b[A-Za-z][\w]*-\d+\b/g) ?? [])]

// The dependencies that are not done yet (a dependency with no ticket counts as not done).
export function blockedBy(t: Ticket, byId: Map<string, Ticket>): string[] {
  return (t.dependsOn ?? []).filter(d => byId.get(d)?.status !== 'done')
}

// DECISIONS.md headings, newest (last) first, skipping the format example in code fences.
export function parseDecisions(src: string, limit = 3): DecisionNote[] {
  const out: DecisionNote[] = []
  let isFence = false
  for (const line of src.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { isFence = !isFence; continue }
    if (isFence) continue
    const m = /^##\s+(D-\d+)\s*[—–:-]+\s*(.+?)\s*(?:\((\d{4}-\d{2}-\d{2})\))?\s*$/.exec(line)
    if (m) out.push({ id: m[1]!, title: m[2]!, ...(m[3] ? { date: m[3] } : {}) })
  }
  return out.slice(-limit).reverse()
}

// Run records summed per agent: runs, review verdicts, rework, time, rate limits.
export function statsOf(runs: Record<string, unknown>[]): AgentRunStats[] {
  const by = new Map<string, AgentRunStats & { secs: number[] }>()
  for (const r of runs) {
    const agent = holderOf(String(r.agent ?? r.tool ?? r.implementer ?? '')) ?? ''
    if (!agent) continue
    const s = by.get(agent) ?? { agent, runs: 0, approved: 0, rejected: 0, reworks: 0, rateLimited: 0, secs: [] }
    s.runs++
    const verdict = String(r.reviewVerdict ?? r.verdict ?? '')
    if (/^approved/i.test(verdict)) s.approved++
    else if (/reject/i.test(verdict)) s.rejected++
    if (typeof r.reworkCount === 'number') s.reworks += r.reworkCount
    if (r.rateLimited === true) s.rateLimited++
    if (typeof r.durationSec === 'number' && r.durationSec > 0) s.secs.push(r.durationSec)
    by.set(agent, s)
  }
  return [...by.values()].sort((a, b) => b.runs - a.runs).map(({ secs, ...s }) => ({ ...s, ...(secs.length ? { avgSec: secs.reduce((n, x) => n + x, 0) / secs.length } : {}) }))
}

const HOOK_EVENTS = new Set(['session.started', 'session.ended', 'subagent.stopped'])
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// A few words from an object detail, plus the top-level fields older lines and Mission
// Control's backfill put beside it (note, subject, commit).
function detailText(o: Record<string, unknown>): string | undefined {
  if (typeof o.detail === 'string') return o.detail || undefined
  const d = isObj(o.detail) ? o.detail : {}
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : '')
  const sha = s(d.sha) || s(d.commit) || s(o.commit)
  const words = [
    s(o.note) || s(d.note) || s(o.subject) || s(d.subject),
    s(d.reason),
    [s(d.agent), s(d.model), s(d.effort)].filter(Boolean).join(' '),
    s(d.id),
    sha ? sha.slice(0, 8) : '',
    typeof d.durationSec === 'number' && d.durationSec > 0 ? `${Math.round(d.durationSec / 60)} min` : '',
    typeof d.touchedFiles === 'number' ? `${d.touchedFiles} file${d.touchedFiles === 1 ? '' : 's'}` : '',
    d.rateLimited === true ? 'rate-limited' : '',
  ].filter(Boolean)
  return words.length ? words.join(' · ') : undefined
}

// The GitHub issue a line is about: `issue: 28` or `issue: "#28"`.
const issueOf = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/^#/, '')) : NaN
  return Number.isInteger(n) && n > 0 ? n : undefined
}

// One JSON object per line; a line that is not one is skipped. Newest first, at most `limit`.
// Hook lines in a row fold into one event, so a busy day of sessions does not hide the work.
export function parseActivity(src: string, limit = 30): ActivityEvent[] {
  const all: ActivityEvent[] = []
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line) as unknown
      if (!isObj(o) || typeof o.event !== 'string') continue
      const str = (v: unknown) => (typeof v === 'string' && v && v !== '-' ? v : undefined)
      const d = isObj(o.detail) ? o.detail : {}
      const issue = issueOf(o.issue)
      all.push({
        ts: str(o.ts) ?? '', actor: str(o.actor) ?? '', ticket: str(o.ticket), ...(issue ? { issue } : {}), event: o.event,
        detail: HOOK_EVENTS.has(o.event) ? undefined : detailText(o), from: str(o.from) ?? str(d.from), to: str(o.to) ?? str(d.to),
      })
    } catch { /* skip a bad line */ }
  }
  const out: ActivityEvent[] = []
  for (const a of all.reverse()) {
    if (HOOK_EVENTS.has(a.event)) {
      const top = out[out.length - 1]
      const group = top?.hooks ? top : undefined
      const h = group?.hooks ?? { started: 0, ended: 0, subagents: 0 }
      if (a.event === 'session.started') h.started++
      else if (a.event === 'session.ended') h.ended++
      else h.subagents++
      if (!group) out.push({ ts: a.ts, actor: a.actor, event: 'claude.sessions', hooks: h })
    } else out.push(a)
    if (out.length > limit) break
  }
  return out.slice(0, limit)
}

export const holderOf = (assignee: string | undefined): string | undefined => {
  const a = (assignee ?? '').trim().toLowerCase()
  if (!a || a === '-' || a === 'none' || a === 'null') return undefined
  if (a.startsWith('antigravity')) return 'agy'
  return a
}
const HOLDER_NAME: Record<string, string> = { codex: 'Codex', agy: 'agy', opencode: 'OpenCode', claude: 'Claude' }
const HOLDER_COLOR: Record<string, string> = { codex: '#1f1f1f', agy: '#378add', opencode: '#ba7517', claude: '#d97757' }
export const holderName = (who: string) => HOLDER_NAME[who] ?? who

export type BoardFilter = 'all' | 'mine' | 'agents' | 'blocked'
export function filterTickets(list: Ticket[], f: BoardFilter): Ticket[] {
  if (f === 'blocked') return list.filter(t => t.status === 'blocked')
  if (f === 'mine') return list.filter(t => holderOf(t.assignee) === 'claude')
  if (f === 'agents') return list.filter(t => { const who = holderOf(t.assignee); return !!who && who !== 'claude' })
  return list
}

export type Sections = { doing: Ticket[]; review: Ticket[]; blocked: Ticket[]; todo: Ticket[]; done: Ticket[] }
export function sectionsOf(list: Ticket[]): Sections {
  const by = (...s: TicketStatus[]) => list.filter(t => s.includes(t.status))
  return { doing: by('in_progress'), review: by('in_review', 'rework'), blocked: by('blocked'), todo: by('todo', 'ready'), done: by('done') }
}

const hhmm = (ts: string): string => {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
export function activityLine(a: ActivityEvent): { time: string; text: string } {
  if (a.hooks) {
    const h = a.hooks
    const parts = [h.started ? `${plural(h.started, 'session', 'sessions')} started` : '', h.ended ? `${h.ended} ended` : '', h.subagents ? `${plural(h.subagents, 'subagent', 'subagents')} stopped` : ''].filter(Boolean)
    return { time: hhmm(a.ts), text: `Claude: ${parts.join(', ')}` }
  }
  const what = a.event.replace(/[._]/g, ' ')
  const move = a.to ? ` to ${a.to.replace(/_/g, ' ')}` : ''
  const about = [a.issue ? `#${a.issue}` : '', a.ticket ?? ''].filter(Boolean).join(' ')
  return { time: hhmm(a.ts), text: `${about ? `${about} ` : ''}${what}${move}${a.detail ? `: ${a.detail}` : ''}${a.actor ? ` · ${a.actor}` : ''}` }
}

// ---------------------------------------------------------------- loading
const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p

async function walk($: EngineInterface, dir: string, out: string[], depth: number): Promise<void> {
  if (depth > 6 || out.length >= MAX_TICKETS) return
  const entries = await $.fs.list(dir).catch(() => [])
  for (const en of entries) {
    if (out.length >= MAX_TICKETS) return
    const path = `${dir}/${en.name}`
    if (en.kind === 'dir') await walk($, path, out, depth + 1)
    else if (en.kind === 'file' && /\.md$/i.test(en.name) && !/^template\.md$/i.test(en.name)) out.push(path)
  }
}

// Where .ops lives: the main checkout when the session runs in a linked worktree and the
// main checkout has one (hooks and run logs write there), else the session's own root.
const opsRoots = new Map<string, string>()
async function opsRootOf($: EngineInterface, root: string): Promise<string> {
  const known = opsRoots.get(root)
  if (known) return known
  let at = root
  try {
    const r = await $.process.run(['git', '-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { timeoutMs: 5000 })
    const main = r.exitCode === 0 ? mainCheckoutOf(r.stdout) : ''
    if (main && main.toLowerCase() !== root.toLowerCase() && (await $.fs.exists(`${main}/.ops`).catch(() => false))) at = main
  } catch { /* no git: the session's own root */ }
  opsRoots.set(root, at)
  return at
}

async function loadBoard($: EngineInterface): Promise<void> {
  const here = ((await $.session.repo().catch(() => null))?.root ?? (await $.session.cwd())).replace(/\\/g, '/')
  const root = await opsRootOf($, here)
  const dir = `${root}/.ops/tickets`
  if (!(await $.fs.exists(dir).catch(() => false))) {
    if ((await read($, board)) !== null) await update($, board, () => null)
    return
  }
  const files: string[] = []
  await walk($, dir, files, 0)
  const tickets: Ticket[] = []
  for (const f of files.sort()) {
    const src = await $.fs.read(f).catch(() => '')
    const t = parseTicket(src, f.slice(root.length + 1))
    if (t) tickets.push(t)
  }
  const raw = await $.fs.read(`${root}/.ops/log/activity.jsonl`).catch(() => '')
  // More lines than are shown: runs of hook lines fold into one.
  const last = raw.split(/\r?\n/).filter(l => l.trim()).slice(-300).join('\n')
  const decisions = parseDecisions(await $.fs.read(`${root}/.ops/memory/DECISIONS.md`).catch(() => ''))
  const runs: Record<string, unknown>[] = []
  for (const d of (await $.fs.list(`${root}/.ops/runs`).catch(() => [])).filter(x => x.kind === 'dir').slice(0, 200)) {
    for (const f of (await $.fs.list(`${root}/.ops/runs/${d.name}`).catch(() => [])).filter(x => x.kind === 'file' && x.name.endsWith('.json'))) {
      if (runs.length >= 400) break
      try { runs.push(JSON.parse(String(await $.fs.read(`${root}/.ops/runs/${d.name}/${f.name}`))) as Record<string, unknown>) } catch { /* unreadable run */ }
    }
  }
  const snap: BoardSnapshot = { root, project: baseName(root), tickets, activity: parseActivity(last, 30), decisions, agentStats: statsOf(runs), readAt: await $.clock.now() }
  const was = await read($, board)
  const key = (b: BoardSnapshot) => JSON.stringify([b.root, b.tickets, b.activity, b.decisions ?? [], b.agentStats ?? []])
  const same = !!was && key(was) === key(snap)
  if (!same) await update($, board, () => snap)
}

export function registerBoard(on: On): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    const started = await next(e)
    await loadBoard($).catch(() => undefined)
    $.clock.every(REFRESH_MS, () => void loadBoard($).catch(() => undefined))
    return started
  })

  on('ui.render', { component: 'Pane', requestId: 'mission-control' }, async ($, e, next) => {
    const p = { ...DEFAULT_PANEL, ...(await read($, panel)) }
    const s = settingsOf(await read($, settings))
    if (activeTab(p.tab, s) !== 'board') return next(e)
    const ui = $.ui.resolve(e)
    const c = makeCtx(e, ui, await $.clock.now())
    const { Box } = ui
    const snap = await read($, board)
    const badges = badgesFrom(await read($, agents), await read($, delegations), snap)
    const go = (f: BoardFilter) => void update($, panel, q => ({ ...q, boardFilter: f }))
    const toggleDone = () => void update($, panel, q => ({ ...q, isDoneCollapsed: !q.isDoneCollapsed }))
    return (
      <Box flexDirection="column" gap={1}>
        {tabBar(ui, 'board', badges, s, t => void update($, panel, q => ({ ...q, tab: t })), c.isDesktop ? c.W : 0, c.at)}
        {snap ? boardBody(c, snap, p.boardFilter, p.isDoneCollapsed, s.look.theme, s.look.motion, go, toggleDone) : emptyBody(c, s, () => void $.prompt.fill({ text: '/ai-team-project-kickoff', mode: 'replace' }))}
      </Box>
    )
  }).catch(($, e, next) => paneFailed($, e, next.error, 'board'))
}

// ---------------------------------------------------------------- drawing
function emptyBody(c: TabCtx, s: Settings, kickoff: () => void) {
  const { Button } = c.ui
  return emptyState(c, s.look, 'board', 'No board in this project', 'Mission Control reads tickets from .ops/tickets. Start one with /ai-team-project-kickoff.', 'architect', '#7F77DD',
    <Button key="kickoff" label="Start a board" variant="primary" onPress={kickoff} />)
}

const ROW = 28, ROW2 = 46
// A ticket with dependencies or a model gets a second line: what it waits for, then the model.
const hasMeta = (t: Ticket) => !!(t.dependsOn?.length || t.model)
const rowH = (t: Ticket) => (hasMeta(t) ? ROW2 : ROW)
const sectionH = (list: Ticket[]) => 26 + list.reduce((n, t) => n + rowH(t), 0) + 6
function metaSvg(t: Ticket, byId: Map<string, Ticket>, x: number, y: number, max: number): string {
  const waits = blockedBy(t, byId)
  let out = '', at = x
  if (waits.length) {
    const s = `⛓ Blocked by ${waits.join(', ')}`
    out += text(at, y, s, { size: 11, weight: 600, cls: 'fl', max })
    at += textWidth(s, 11) + 10
  } else if (t.dependsOn?.length) {
    const s = `✓ ${t.dependsOn.join(', ')} done`
    out += text(at, y, s, { size: 11, cls: t.status === 'todo' || t.status === 'ready' ? 'ok' : 's', max })
    at += textWidth(s, 11) + 10
  }
  if (t.model && at < x + max - 40) out += text(at, y, t.model, { size: 11, cls: 'm', mono: true, max: x + max - at })
  return out
}
const logRows = (act: ActivityEvent[]) => Math.max(1, Math.min(8, act.length))

function badgeSvg(right: number, y: number, who: string) {
  const name = holderName(who), w = textWidth(name, 10.5) + 12, x = right - w
  const color = HOLDER_COLOR[who] ?? '#6b6b68'
  return { w, svg: `<rect x="${x}" y="${y}" width="${w}" height="16" rx="2" style="fill:${color};opacity:.18"/>${text(x + 6, y + 11.5, name, { size: 10.5, weight: 600 })}` }
}

// Done / total per milestone, in the order they first appear.
export function milestonesOf(list: Ticket[]): { name: string; done: number; total: number }[] {
  const by = new Map<string, { name: string; done: number; total: number }>()
  for (const t of list) {
    if (!t.milestone) continue
    const m = by.get(t.milestone) ?? { name: t.milestone, done: 0, total: 0 }
    m.total++
    if (t.status === 'done') m.done++
    by.set(t.milestone, m)
  }
  return [...by.values()]
}
const headH = (snap: BoardSnapshot) => (milestonesOf(snap.tickets).length > 1 ? 84 : 66)

function headSvg(W: number, snap: BoardSnapshot, theme: Theme, motion: Motion) {
  const done = snap.tickets.filter(t => t.status === 'done').length, total = snap.tickets.length
  const tag = '.ops/tickets'
  const ms = milestonesOf(snap.tickets)
  const msLine = ms.length > 1 ? text(0, 80, ms.map(m => `${m.name} ${m.done}/${m.total}`).join('  ·  '), { size: 11, cls: 's', max: W }) : ''
  return wide(W, headH(snap), `${msLine}${text(0, 14, 'PROJECT', { size: 10.5, cls: 's' })}
${text(0, 34, snap.project, { size: 14, weight: 600, max: W - 130 })}
${iconInk('ticket', W - textWidth(tag, 11) - 20, 22, 13)}${text(W, 34, tag, { size: 11, cls: 's', anchor: 'end' })}
${progress(0, 50, W, total ? done / total : 0, done === total && total > 0 ? 'done' : 'real', '#7f77dd', `${done}/${total} done`)}`, theme, motion)
}

function sectionSvg(W: number, title: string, list: Ticket[], tone: 'plain' | 'blocked', byId: Map<string, Ticket>, theme: Theme, motion: Motion) {
  const H = sectionH(list)
  let y = 26
  const rows = list.map((t, i) => {
    const who = holderOf(t.assignee)
    const b = who ? badgeSvg(W - 8, y + 6, who) : undefined
    const right = b ? b.w + 14 : 28
    const rh = rowH(t)
    const out = `${text(8, y + 18, t.id, { size: 11, cls: 's', mono: true })}${text(72, y + 18, t.title, { size: 12.5, max: W - 72 - right })}${b ? b.svg : text(W - 10, y + 18, '—', { size: 12, cls: 'm', anchor: 'end' })}${hasMeta(t) ? metaSvg(t, byId, 72, y + 35, W - 72 - 10) : ''}${i < list.length - 1 ? hline(8, W - 8, y + rh - 1) : ''}`
    y += rh
    return out
  }).join('')
  const head = tone === 'blocked'
    ? `<circle class="fl" cx="14" cy="14" r="3"/>${text(24, 18, title, { size: 11.5, weight: 600, cls: 'fl' })}`
    : text(8, 18, title, { size: 11.5, weight: 600, cls: 's' })
  return wide(W, H, `${tone === 'blocked' ? box(0, 0, W, H, 'ft') : ''}${head}${rows}`, theme, motion)
}

function logSvg(W: number, act: ActivityEvent[], theme: Theme, motion: Motion) {
  const lines = act.slice(0, 8).map(activityLine)
  const rows = lines.length
    ? lines.map((l, i) => `${text(0, 38 + i * 22, l.time, { size: 11, cls: 'm', mono: true })}${text(48, 38 + i * 22, l.text, { size: 12, max: W - 48 })}`).join('')
    : text(0, 38, 'No activity yet', { size: 12, cls: 's' })
  return wide(W, 24 + logRows(act) * 22, `${text(0, 14, 'Activity log', { size: 12, weight: 600 })}${rows}`, theme, motion)
}

const decisionsH = (n: number) => 24 + n * 22
function decisionsSvg(W: number, list: DecisionNote[], theme: Theme, motion: Motion) {
  const rows = list.map((d, i) => {
    const y = 38 + i * 22
    return `${text(0, y, d.id, { size: 11, cls: 's', mono: true })}${text(48, y, d.title, { size: 12, max: W - 48 - (d.date ? 82 : 0) })}${d.date ? text(W, y, d.date, { size: 11, cls: 'm', anchor: 'end' }) : ''}`
  }).join('')
  return wide(W, decisionsH(list.length), `${text(0, 14, 'Latest decisions', { size: 12, weight: 600 })}${text(W, 14, '.ops/memory/DECISIONS.md', { size: 11, cls: 'm', anchor: 'end' })}${rows}`, theme, motion)
}

const statsH = (n: number) => 24 + n * 26
const statLine = (s: AgentRunStats) => {
  const judged = s.approved + s.rejected
  return [`${s.runs} run${s.runs === 1 ? '' : 's'}`, judged ? `${Math.round((s.approved / judged) * 100)}% approved` : '', s.reworks ? `${s.reworks} rework${s.reworks === 1 ? '' : 's'}` : '', s.avgSec ? `avg ${fmtSpan(s.avgSec * 1000)}` : '', s.rateLimited ? `${s.rateLimited} rate-limited` : ''].filter(Boolean).join(' · ')
}
function statsSvg(W: number, list: AgentRunStats[], theme: Theme, motion: Motion) {
  const rows = list.map((s, i) => {
    const y = 26 + i * 26
    const b = badgeSvg(8 + textWidth(holderName(s.agent), 10.5) + 12, y + 2, s.agent)
    return `${b.svg}${text(b.w + 18, y + 14, statLine(s), { size: 12, cls: 's', max: W - b.w - 18 })}`
  }).join('')
  return wide(W, statsH(list.length), `${text(0, 14, 'Agents on this board', { size: 12, weight: 600 })}${text(W, 14, '.ops/runs', { size: 11, cls: 'm', anchor: 'end' })}${rows}`, theme, motion)
}

function boardBody(c: TabCtx, snap: BoardSnapshot, filter: BoardFilter, isDoneCollapsed: boolean, theme: Theme, motion: Motion, go: (f: BoardFilter) => void, toggleDone: () => void) {
  const { Box, Text, Button } = c.ui
  const Svg = 'Svg' in c.ui ? c.ui.Svg : undefined
  const blockedN = snap.tickets.filter(t => t.status === 'blocked').length
  const total = snap.tickets.length
  const done = snap.tickets.filter(t => t.status === 'done').length
  const sec = sectionsOf(filterTickets(snap.tickets, filter))
  const byId = new Map(snap.tickets.map(t => [t.id, t] as const))
  const decisions = snap.decisions ?? [], stats = snap.agentStats ?? []
  const filters = (
    <Box key="filters" flexDirection="row" gap={1} flexWrap="wrap">
      {([['all', 'All'], ['mine', 'Mine'], ['agents', 'Agents'], ['blocked', `Blocked · ${blockedN}`]] as [BoardFilter, string][]).map(([id, name]) => (
        <Button key={`f-${id}`} label={name} plain={id !== filter ? true : undefined} variant={id === filter ? 'primary' : undefined} onPress={() => go(id)} />
      ))}
    </Box>
  )
  const doneBtn = sec.done.length > 0 ? <Button key="done-toggle" label={`${isDoneCollapsed ? '▸' : '▾'} Done · ${sec.done.length}`} plain onPress={toggleDone} /> : null
  const groups: [string, Ticket[], 'plain' | 'blocked'][] = [['Doing', sec.doing, 'plain'], ['Review', sec.review, 'plain'], ['Blocked', sec.blocked, 'blocked'], ['To do', sec.todo, 'plain']]
  const shown = groups.filter(([, l]) => l.length > 0)

  if (c.isDesktop && Svg) {
    const W = c.W
    return (
      <Box key="board" flexDirection="column" gap={1}>
        <Svg source={headSvg(W, snap, theme, motion)} alt={`${snap.project}, ${done} of ${total} tickets done`} height={headH(snap)} />
        {filters}
        {shown.map(([name, list, tone]) => (
          <Svg key={name} source={sectionSvg(W, `${name} · ${list.length}`, list, tone, byId, theme, motion)} alt={`${name}: ${list.map(t => `${t.id} ${t.title}${blockedBy(t, byId).length ? `, blocked by ${blockedBy(t, byId).join(' and ')}` : ''}`).join(', ')}`} height={sectionH(list)} />
        ))}
        {shown.length === 0 && <Text dimColor>Nothing here with this filter.</Text>}
        {doneBtn}
        {!isDoneCollapsed && sec.done.length > 0 && (
          <Svg source={sectionSvg(W, `Done · ${sec.done.length}`, sec.done, 'plain', byId, theme, motion)} alt={`Done: ${sec.done.map(t => t.id).join(', ')}`} height={sectionH(sec.done)} />
        )}
        {stats.length > 0 && <Svg key="stats" source={statsSvg(W, stats, theme, motion)} alt={stats.map(s => `${holderName(s.agent)}: ${statLine(s)}`).join('; ')} height={statsH(stats.length)} />}
        {decisions.length > 0 && <Svg key="decisions" source={decisionsSvg(W, decisions, theme, motion)} alt={`Latest decisions: ${decisions.map(d => `${d.id} ${d.title}`).join('; ')}`} height={decisionsH(decisions.length)} />}
        <Svg source={logSvg(W, snap.activity, theme, motion)} alt="Activity log" height={24 + logRows(snap.activity) * 22} />
      </Box>
    )
  }

  const bw = Math.max(8, Math.min(24, c.cols - 24))
  const row = (t: Ticket) => {
    const who = holderOf(t.assignee)
    const waits = blockedBy(t, byId)
    return (
      <Box key={t.id} flexDirection="column">
        <Text>{`${t.id}  ${clip(t.title, Math.max(12, c.cols - 26))}${who ? `  [${holderName(who)}]` : ''}`}</Text>
        {waits.length > 0 && <Text color="red">{`        ⛓ Blocked by ${waits.join(', ')}`}</Text>}
      </Box>
    )
  }
  return (
    <Box key="board" flexDirection="column">
      <Text bold>{`${snap.project}  .ops/tickets`}</Text>
      <Text>{`${barText(total ? done / total : 0, bw)} ${total ? Math.round((done / total) * 100) : 0}%  ${done}/${total} done`}</Text>
      {filters}
      {shown.map(([name, list, tone]) => (
        <Box key={name} flexDirection="column" marginTop={1}>
          <Text bold color={tone === 'blocked' ? 'red' : undefined}>{`${name} · ${list.length}`}</Text>
          {list.map(row)}
        </Box>
      ))}
      {shown.length === 0 && <Text dimColor>Nothing here with this filter.</Text>}
      {doneBtn}
      {!isDoneCollapsed && sec.done.map(row)}
      {stats.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Agents on this board</Text>
          {stats.map(s => <Text key={`st-${s.agent}`}>{`${holderName(s.agent)}  ${statLine(s)}`}</Text>)}
        </Box>
      )}
      {decisions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Latest decisions</Text>
          {decisions.map(d => <Text key={`dc-${d.id}`}>{`${d.id}  ${clip(d.title, Math.max(16, c.cols - 22))}${d.date ? `  ${d.date}` : ''}`}</Text>)}
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Activity log</Text>
        {snap.activity.slice(0, 8).map((a, i) => { const l = activityLine(a); return <Text key={`a${i}`}>{`${l.time}  ${clip(l.text, Math.max(16, c.cols - 8))}`}</Text> })}
        {snap.activity.length === 0 && <Text dimColor>No activity yet</Text>}
      </Box>
    </Box>
  )
}

// When drawing fails, say so in the pane (and keep the reason for a bug report) instead of
// leaving it blank.
async function paneFailed($: EngineInterface, e: PaneInput, error: unknown, where: string): Promise<RenderElement> {
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : JSON.stringify(error)
  await $.store.set('lastError', { where, reason, at: await $.clock.now() }).catch(() => undefined)
  return failedView($.ui.resolve(e), where, reason)
}
