// Log: the daily log (per project, kept in $.store), the /standup and /handoff
// commands, and the Log tab.
import { atom, read, update } from 'claude-code'
import { failedView } from '../kit/ui'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { AgentRecord, BoardSnapshot, CommandDoc, DayLog, Delegation, Handoff, LogEntry } from '../../types'
import { emptyState } from '../kit/ui'
import { activeTab, badgesFrom, clip, tabBar } from '../kit/chrome'
import { box, hline, svg, text, textWidth, wide } from '../kit/draw'
import { costOf, fmtCost } from '../kit/role'
import { DEFAULT_PANEL, DEFAULT_SETTINGS, STORE, localDay, makeCtx, settingsOf } from '../kit/state'
import type { PaneInput } from '../kit/state'
import type { TabCtx } from '../kit/state'

const agents = atom({ plugin: 'mission-control', key: 'agents' } as const, {} as Record<string, AgentRecord>)
const board = atom({ plugin: 'mission-control', key: 'board' } as const, null as BoardSnapshot | null)
const delegations = atom({ plugin: 'mission-control', key: 'delegations' } as const, {} as Record<string, Delegation>)
const log = atom({ plugin: 'mission-control', key: 'log' } as const, null as DayLog | null)
const handoff = atom({ plugin: 'mission-control', key: 'handoff' } as const, null as Handoff | null)
const lastDoc = atom({ plugin: 'mission-control', key: 'lastDoc' } as const, null as CommandDoc | null)
const panel = atom({ plugin: 'mission-control', key: 'panel' } as const, DEFAULT_PANEL)
const settings = atom({ plugin: 'mission-control', key: 'settings' } as const, DEFAULT_SETTINGS)

const MAX_ENTRIES = 300
const MODEL = 'claude-sonnet-5-5'
type Theme = 'follow' | 'light' | 'dark'
type Motion = 'full' | 'calm' | 'off'

// ---------------------------------------------------------------- pure helpers
export const emptyDay = (day: string): DayLog => ({ day, entries: [], sessions: 0, agents: 0, spentUsd: 0 })
export const firstLine = (s: string | undefined): string => (s ?? '').split(/\r?\n/).map(l => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) ?? ''

// The log as stored may lack fields after an older version; fill them.
export const dayOf = (v: unknown, day: string): DayLog => {
  const d = v as Partial<DayLog> | null | undefined
  return d && d.day === day && Array.isArray(d.entries) ? { ...emptyDay(day), ...d } : emptyDay(day)
}

export function addEntry(d: DayLog, e: LogEntry): DayLog {
  const entries = [...d.entries, e].slice(-MAX_ENTRIES)
  return {
    ...d, entries,
    sessions: d.sessions + (e.kind === 'session' ? 1 : 0),
    agents: d.agents + (e.kind === 'agent' ? 1 : 0),
    spentUsd: d.spentUsd + (e.costUsd ?? 0),
  }
}

export type ProjectDay = { project: string; sessions: number; agents: number; spentUsd: number; lines: string[] }
export function byProject(d: DayLog): ProjectDay[] {
  const map = new Map<string, ProjectDay>()
  for (const e of d.entries) {
    const p = map.get(e.project) ?? { project: e.project, sessions: 0, agents: 0, spentUsd: 0, lines: [] }
    if (e.kind === 'session') p.sessions++
    else {
      if (e.kind === 'agent') p.agents++
      p.lines.push(e.text)
    }
    p.spentUsd += e.costUsd ?? 0
    map.set(e.project, p)
  }
  return [...map.values()]
}
export const hasWork = (d: DayLog): boolean => d.entries.some(e => e.kind !== 'session')

const HEADS = ['Done', 'Doing', 'Blocked', 'Next'] as const
// Reads "Done / Doing / Blocked / Next" sections out of the model's reply.
export function parseSections(src: string): CommandDoc['sections'] {
  const out: CommandDoc['sections'] = []
  for (const line of src.split(/\r?\n/)) {
    const head = HEADS.find(x => new RegExp(`^[#*\\s]*${x}\\b[:*\\s]*$`, 'i').test(line.trim()))
    if (head) { out.push({ heading: head, lines: [] }); continue }
    const t = line.replace(/^[\s>*\-•]+/, '').trim()
    if (t && out.length) out[out.length - 1]!.lines.push(t)
  }
  return out.filter(s => s.lines.length)
}

export type StandupInput = { day: DayLog; board: BoardSnapshot | null }
export function plainSections({ day, board: b }: StandupInput): CommandDoc['sections'] {
  const done: string[] = [], doing: string[] = [], blocked: string[] = [], next: string[] = []
  for (const p of byProject(day)) for (const l of p.lines.slice(-6)) done.push(`${p.project}: ${l}`)
  for (const t of b?.tickets ?? []) {
    const l = `${b!.project}: ${t.id} ${t.title}${t.assignee ? ` (${t.assignee})` : ''}`
    if (t.status === 'in_progress' || t.status === 'in_review' || t.status === 'rework') doing.push(l)
    else if (t.status === 'blocked') blocked.push(l)
    else if (t.status === 'waiting') blocked.push(`${l} (waiting on owner)`)
    else if (t.status === 'ready' || t.status === 'todo') next.push(l)
  }
  return [
    { heading: 'Done', lines: done.length ? done : ['Nothing logged yet today'] },
    { heading: 'Doing', lines: doing.length ? doing : ['Nothing in progress'] },
    { heading: 'Blocked', lines: blocked.length ? blocked : ['Nothing blocked'] },
    { heading: 'Next', lines: next.slice(0, 4).length ? next.slice(0, 4) : ['Nothing queued'] },
  ]
}
export function standupPrompt(i: StandupInput): string {
  const facts = plainSections(i).map(s => `${s.heading}:\n${s.lines.map(l => `- ${l}`).join('\n')}`).join('\n\n')
  return `Write a short stand-up for ${i.day.day} from these facts. Use exactly four sections headed Done, Doing, Blocked, Next, each a few short bullet lines, one per line, starting with the project name. Plain words, no preamble, invent nothing.\n\n${facts}`
}

export function renderDoc(d: CommandDoc): string {
  return [d.title, ...d.sections.flatMap(s => ['', s.heading, ...s.lines.map(l => `- ${l}`)])].join('\n')
}

const dateLabel = (ms: number): string => new Date(ms).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
const hhmm = (ms: number): string => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`
const nameOf = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

// ---------------------------------------------------------------- state helpers (own $)
async function projectOf($: EngineInterface): Promise<string> {
  const repo = await $.session.repo().catch(() => null)
  return nameOf(repo?.root ?? (await $.session.cwd()))
}

async function loadDay($: EngineInterface, day: string): Promise<DayLog> {
  const mirrored = await read($, log)
  if (mirrored && mirrored.day === day) return dayOf(mirrored, day)
  return dayOf(await $.store.get(STORE.dayLog(day)).catch(() => null), day)
}

async function record($: EngineInterface, entry: Omit<LogEntry, 'at' | 'project'> & { project?: string }): Promise<void> {
  const at = await $.clock.now()
  const day = localDay(at)
  const next = addEntry(await loadDay($, day), { ...entry, at, project: entry.project ?? (await projectOf($)) })
  await $.store.set(STORE.dayLog(day), next)
  await update($, log, () => next)
}

async function askModel($: EngineInterface, prompt: string): Promise<string | undefined> {
  const r = await $.model.complete({ model: MODEL, prompt, timeoutMs: 25_000 }).catch(() => undefined)
  return r && r.isAnswered && r.text.trim() ? r.text.trim() : undefined
}

async function runStandup($: EngineInterface): Promise<string> {
  const at = await $.clock.now()
  const input: StandupInput = { day: await loadDay($, localDay(at)), board: await read($, board) }
  const projects = new Set([...input.day.entries.map(e => e.project), ...(input.board ? [input.board.project] : [])])
  const reply = await askModel($, standupPrompt(input))
  const parsed = reply ? parseSections(reply) : []
  const doc: CommandDoc = {
    kind: 'standup', at, title: `Standup · ${dateLabel(at)} · ${projects.size} project${projects.size === 1 ? '' : 's'}`,
    sections: parsed.length >= 2 ? parsed : plainSections(input),
  }
  await update($, lastDoc, () => doc)
  return renderDoc(doc)
}

async function runHandoff($: EngineInterface, note: string): Promise<string> {
  const at = await $.clock.now()
  const project = await projectOf($)
  let body = note.trim()
  if (!body) {
    const mine = (await loadDay($, localDay(at))).entries.filter(e => e.project === project && e.kind !== 'session').map(e => e.text)
    const fallback = mine.length ? `Today: ${mine.slice(-5).join('; ')}.` : 'No work was logged this session.'
    const reply = mine.length
      ? await askModel($, `Write a one-paragraph handoff note for the next session of the project "${project}": what was done, where it stopped, what comes next. Plain words, under 70 words, no preamble, invent nothing.\n\nToday's log:\n${mine.map(l => `- ${l}`).join('\n')}`)
      : undefined
    body = reply ?? fallback
  }
  const handoffNote: Handoff = { project, at, text: body }
  await $.store.set(STORE.handoff(project), handoffNote)
  await update($, handoff, () => handoffNote)
  return `Handoff saved for ${project}.\n${body}`
}

export function registerLog(on: On): void {
  on('turn.complete', { reason: ['answer', 'aborted', 'refusal', 'error'] }, async ($, e, next) => {
    if (e.agentId !== undefined) {
      const mine = (await read($, agents))[e.agentId]
      const u = e.usage
      const line = firstLine(e.answer) || (e.reason === 'answer' ? mine?.description : e.reason === 'aborted' ? 'Stopped' : 'Failed') || 'Agent turn'
      const failed = e.reason === 'refusal' || e.reason === 'error'
      await record($, {
        kind: 'agent', text: clip(`${mine ? `${mine.callsign}: ` : ''}${failed ? 'failed, ' : ''}${line}`, 140),
        ...(u ? { costUsd: costOf(u.model || mine?.model || '', u) } : {}),
      }).catch(() => undefined)
    }
    return next(e)
  })

  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'standup', description: 'Today across every project: done, doing, blocked, next' }).catch(() => undefined)
    await $.command.register({ name: 'handoff', description: 'Write the note the next session starts from', argumentHint: '[note]' }).catch(() => undefined)
    await record($, { kind: 'session', text: 'Session started' }).catch(() => undefined)
    const saved = await $.store.get(STORE.handoff(await projectOf($))).catch(() => null)
    if (saved) await update($, handoff, () => saved as Handoff)
    return started
  })

  on('command.run', { command: 'standup' }, async ($) => ({ text: await runStandup($) }))
  on('command.run', { command: 'handoff' }, async ($, cmd) => ({ text: await runHandoff($, cmd.args) }))

  on('ui.render', { component: 'Pane', requestId: 'mission-control' }, async ($, e, next) => {
    const p = { ...DEFAULT_PANEL, ...(await read($, panel)) }
    const s = settingsOf(await read($, settings))
    if (activeTab(p.tab, s) !== 'log') return next(e)
    const ui = $.ui.resolve(e)
    const at = await $.clock.now()
    const c = makeCtx(e, ui, at)
    const { Box } = ui
    const badges = badgesFrom(await read($, agents), await read($, delegations), await read($, board))
    const day = dayOf(await read($, log), localDay(at))
    const last = await read($, handoff)
    const standup = () => void $.prompt.fill({ text: '/standup', mode: 'replace' }).catch(() => undefined)
    return (
      <Box flexDirection="column" gap={1}>
        {tabBar(ui, 'log', badges, s, t => void update($, panel, q => ({ ...q, tab: t })), c.isDesktop ? c.W : 0, c.at)}
        {logBody(c, day, last, s.look.theme, s.look.motion, standup)}
      </Box>
    )
  }).catch(($, e, next) => paneFailed($, e, next.error, 'log'))
}

// ---------------------------------------------------------------- drawing
const money = (usd: number) => `≈${fmtCost(usd)}`
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const metaOf = (p: ProjectDay) => `${plural(p.sessions, 'session')} · ${plural(p.agents, 'agent')} · ${money(p.spentUsd)}`
const BULLETS = 4

function figuresSvg(W: number, d: DayLog, theme: Theme, motion: Motion) {
  const cell = (W - 16) / 3
  const items: [string, string][] = [['SESSIONS', String(d.sessions)], ['AGENTS', String(d.agents)], ['SPENT', money(d.spentUsd)]]
  return wide(W, 56, items.map(([k, v], i) => `${box(i * (cell + 8), 0, cell, 52)}${text(i * (cell + 8) + 12, 20, k, { size: 10.5, cls: 's' })}${text(i * (cell + 8) + 12, 42, v, { size: 18, weight: 600 })}`).join(''), theme, motion)
}

function projectSvg(W: number, p: ProjectDay, theme: Theme, motion: Motion) {
  const lines = p.lines.slice(-BULLETS)
  const meta = metaOf(p)
  const H = 30 + lines.length * 20 + 8
  const body = lines.map((l, i) => `${text(4, 46 + i * 20, '•', { size: 12, cls: 's' })}${text(18, 46 + i * 20, l, { size: 12.5, max: W - 22 })}`).join('')
  return { H, svg: wide(W, H, `${text(0, 18, p.project, { size: 13, weight: 600, max: W - textWidth(meta, 11) - 16 })}${text(W, 18, meta, { size: 11, cls: 's', anchor: 'end' })}${hline(0, W, 26)}${body}`, theme, motion) }
}

function logBody(c: TabCtx, d: DayLog, last: Handoff | null, theme: Theme, motion: Motion, standup: () => void) {
  const { Box, Text, Button } = c.ui
  const Svg = 'Svg' in c.ui ? c.ui.Svg : undefined
  const projects = byProject(d)
  const isEmpty = !hasWork(d)
  const date = dateLabel(c.at)
  const gen = <Button key="gen" label="Generate standup" variant="primary" onPress={standup} />
  const handoffHead = last ? `Last handoff · ${last.project}` : ''

  if (c.isDesktop && Svg) {
    const W = c.W
    const dayHead = wide(W, 26, `${text(0, 18, 'Today', { size: 14, weight: 600 })}${text(52, 18, date, { size: 12, cls: 's' })}`, theme, motion)
    return (
      <Box key="log" flexDirection="column" gap={1}>
        <Svg source={dayHead} alt={`Today, ${date}`} height={26} />
        {gen}
        {isEmpty ? emptyState(c, { theme, motion }, 'log', 'Nothing logged today', 'Agents that finish and tickets that move show up here. /standup turns them into a summary.', 'scribe', '#5F8F3E') : (
          <>
            <Svg source={figuresSvg(W, d, theme, motion)} alt={`${d.sessions} sessions, ${d.agents} agents, ${money(d.spentUsd)} spent`} height={56} />
            {projects.map(p => {
              const r = projectSvg(W, p, theme, motion)
              return <Svg key={p.project} source={r.svg} alt={`${p.project}: ${metaOf(p)}. ${p.lines.slice(-BULLETS).join('. ')}`} height={r.H} />
            })}
          </>
        )}
        {last && (
          <Box key="handoff" flexDirection="column">
            <Svg source={wide(W, 26, `${text(0, 18, handoffHead, { size: 13, weight: 600, max: W - 60 })}${text(W, 18, hhmm(last.at), { size: 11, cls: 's', anchor: 'end' })}${hline(0, W, 26)}`, theme, motion)} alt={handoffHead} height={26} />
            <Text>{last.text}</Text>
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Box key="log" flexDirection="column">
      <Text bold>{`Today  ${date}`}</Text>
      {gen}
      {isEmpty ? (
        <Text dimColor>Nothing logged today. Agents that finish and tickets that move show up here.</Text>
      ) : (
        <>
          <Text>{`Sessions ${d.sessions}   Agents ${d.agents}   Spent ${money(d.spentUsd)}`}</Text>
          {projects.map(p => (
            <Box key={p.project} flexDirection="column" marginTop={1}>
              <Text bold>{`${p.project}  ${metaOf(p)}`}</Text>
              {p.lines.slice(-BULLETS).map((l, i) => <Text key={`${p.project}-${i}`}>{`• ${clip(l, Math.max(16, c.cols - 4))}`}</Text>)}
            </Box>
          ))}
        </>
      )}
      {last && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{`${handoffHead}  ${hhmm(last.at)}`}</Text>
          <Text>{last.text}</Text>
        </Box>
      )}
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
