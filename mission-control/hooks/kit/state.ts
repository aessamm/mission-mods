// Every $.state atom Mission Control uses, with its default. Feature modules import
// from here; nobody declares an atom of their own.
import type { RenderInputOf, RenderSurface, Elements } from 'claude-code'

import type { Budget, PanelState, Settings } from '../../types'
import { callsignOf } from './role'

export const P = 'mission-control' as const

export const DEFAULT_SETTINGS: Settings = {
  show: { agents: true, delegations: true, board: true, worktrees: true, log: true, statusLine: true, toastsAll: false, skills: true, inbox: true },
  budget: { mode: 'auto', fiveHourPauseAt: 90, weekPauseAt: 90, dailyUsd: 5, warnAt: 0.8, pauseWhenReached: true },
  routing: { auto: false, maxAgents: 6, byRole: {} },
  look: { theme: 'follow', agentsLayout: 'focus', motion: 'full', names: 'nato' },
  costumes: {},
  agentNames: {},
  statusLine: { where: true, session: true, today: true, context: true, limits: true, lastTurn: true, idle: true, compactions: true, agents: true, cacheTtl: '1h', layout: 'detailed', git: 'chips' },
  boardSource: 'auto',
}
export const DEFAULT_PANEL: PanelState = { tab: 'agents', isCompact: false, isDoneCollapsed: true, expanded: {}, boardFilter: 'all' }

// Atoms are declared in each file that reads or writes them (the validator only follows
// a reference written in the same file): copy the lines you need from ATOMS below.
// Same plugin and key in every file means the same value.
export const ATOMS = `
const agents = atom({ plugin: 'mission-control', key: 'agents' } as const, {} as Record<string, AgentRecord>)
const order = atom({ plugin: 'mission-control', key: 'order' } as const, [] as string[])
const overrides = atom({ plugin: 'mission-control', key: 'overrides' } as const, {} as Record<string, AgentOverride>)
const tick = atom({ plugin: 'mission-control', key: 'tick' } as const, 0)
const panel = atom({ plugin: 'mission-control', key: 'panel' } as const, DEFAULT_PANEL)
const delegations = atom({ plugin: 'mission-control', key: 'delegations' } as const, {} as Record<string, Delegation>)
const delegationOrder = atom({ plugin: 'mission-control', key: 'delegationOrder' } as const, [] as string[])
const board = atom({ plugin: 'mission-control', key: 'board' } as const, null as BoardSnapshot | null)
const worktrees = atom({ plugin: 'mission-control', key: 'worktrees' } as const, null as WorktreeSnapshot | null)
const log = atom({ plugin: 'mission-control', key: 'log' } as const, null as DayLog | null)
const handoff = atom({ plugin: 'mission-control', key: 'handoff' } as const, null as Handoff | null)
const lastDoc = atom({ plugin: 'mission-control', key: 'lastDoc' } as const, null as CommandDoc | null)
const budget = atom({ plugin: 'mission-control', key: 'budget' } as const, DEFAULT_BUDGET)
const alerts = atom({ plugin: 'mission-control', key: 'alerts' } as const, [] as Alert[])
const settings = atom({ plugin: 'mission-control', key: 'settings' } as const, DEFAULT_SETTINGS)
const family = atom({ plugin: 'mission-control', key: 'family' } as const, null as FamilyMember[] | null)
`
export const DEFAULT_BUDGET: Budget = { day: '', spentToday: 0, sessionSpent: 0 }

// $.store keys (kept across sessions).
export const STORE = {
  settings: 'settings',
  dayLog: (day: string) => `log:${day}`,
  spend: (day: string) => `spend:${day}`,
  handoff: (project: string) => `handoff:${project}`,
} as const

export const PANE = 'mission-control'
export const TITLE = 'Mission Control'

// What a tab renderer receives besides $.
export type PaneInput = RenderInputOf<'Pane', RenderSurface>
export type UiTable = Elements[RenderSurface]
// $ never travels in here: the validator only follows $ within one file.
export type TabCtx = {
  e: PaneInput
  ui: UiTable
  isDesktop: boolean
  W: number          // drawing width in CSS px on desktop
  cols: number       // body columns (terminal)
  at: number         // now, ms
}

export const localDay = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The settings value, typed: call as settingsOf(await read($, settings)).
// (The state library widens nested fields of this atom.)
export const settingsOf = (v: unknown): Settings => {
  const s = (v ?? {}) as Partial<Settings>
  return { ...DEFAULT_SETTINGS, ...s, budget: { ...DEFAULT_SETTINGS.budget, ...(s.budget ?? {}) }, agentNames: { ...(s.agentNames ?? {}) }, statusLine: { ...DEFAULT_SETTINGS.statusLine, ...(s.statusLine ?? {}) } }
}

// What an agent is called, by Settings › Names: "Tester Alpha", "Tester 1", or the person's
// own names as "Omar - (Tester)". Several names for a role are handed out in turn; once
// they run out they come round again with a number ("Omar 2 - (Tester)").
export const namesFor = (s: Settings, key: string): string[] => (s.agentNames[key] ?? '').split(',').map(x => x.trim()).filter(Boolean)
export function nameOf(a: { role: string; callsign: string; nth?: number; isMain?: boolean; isNamed?: boolean }, s: Settings): string {
  if (a.isNamed) return a.callsign
  const key = a.isMain ? 'main' : a.role.toLowerCase()
  const role = a.isMain ? 'Main' : a.role
  const i = a.nth ?? 0
  const own = s.look.names === 'custom' ? namesFor(s, key) : []
  if (own.length) {
    const lap = Math.floor(i / own.length)
    return `${own[i % own.length]}${lap ? ` ${lap + 1}` : ''} - (${role})`
  }
  if (a.isMain) return a.callsign
  if (s.look.names === 'numbers') return `${a.role} ${i + 1}`
  return callsignOf(a.role, i)
}

// Which budget applies: the plan's windows when the account has them (or the person chose
// them), else the daily dollars.
export const planMode = (s: Settings, b: Budget): boolean =>
  s.budget.mode === 'plan' || (s.budget.mode === 'auto' && (b.fiveHour !== undefined || b.week !== undefined))

export type BudgetCheck = { state: 'ok' | 'warn' | 'fail'; ratio: number; label: string; detail: string; deny: string }
const resetIn = (iso: string | undefined, now: number): string => {
  if (!iso) return ''
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)

// The budget's state against its limit, with the words the alert, the gate and the panel use.
// Plan mode: the fuller of the two windows against its pause point; warn from warnAt of it.
export function checkBudget(s: Settings, b: Budget, now: number): BudgetCheck {
  if (planMode(s, b)) {
    const wins = [
      { name: '5-hour', w: b.fiveHour, at: s.budget.fiveHourPauseAt },
      { name: 'Weekly', w: b.week, at: s.budget.weekPauseAt },
    ].filter(x => x.w !== undefined && x.at > 0)
    if (!wins.length) return { state: 'ok', ratio: 0, label: '', detail: '', deny: '' }
    const top = wins.reduce((m, x) => ((x.w!.pct / x.at) > (m.w!.pct / m.at) ? x : m))
    const ratio = top.w!.pct / top.at
    const state = ratio >= 1 ? 'fail' : ratio >= s.budget.warnAt ? 'warn' : 'ok'
    const left = resetIn(top.w!.resetsAt, now)
    return {
      state, ratio,
      label: state === 'fail' ? `${top.name} limit ${Math.round(top.w!.pct)}% used` : `${top.name} limit at ${Math.round(top.w!.pct)}%`,
      detail: `pausing at ${top.at}%${left ? ` · resets in ${left}` : ''}`,
      deny: `${top.name} limit is ${Math.round(top.w!.pct)}% used; new agents pause at ${top.at}%${left ? ` until it resets in ${left}` : ''}. Raise the pause point in Settings › Budget or with /budget ${top.name === '5-hour' ? '5h' : 'week'} <percent>.`,
    }
  }
  const lim = s.budget.dailyUsd
  const ratio = lim > 0 ? b.spentToday / lim : 0
  const state = !(lim > 0) ? 'ok' : ratio >= 1 ? 'fail' : ratio >= s.budget.warnAt ? 'warn' : 'ok'
  return {
    state, ratio,
    label: state === 'fail' ? 'Daily budget reached' : `Today, ${Math.round(ratio * 100)}% of budget`,
    detail: `≈${money(b.spentToday)} of ${money(lim)}`,
    deny: `Daily budget reached (≈${money(b.spentToday)} of ${money(lim)}). Raise it with /budget <dollars>.`,
  }
}

// A Pane hook's common setup, computed from values already read (no $ here).
// The host gives no pane width in px, and its column count does not track the real width,
// so drawings stay at a safe width: one wider than the pane is shrunk as an image, text too.
export function makeCtx(e: PaneInput, ui: UiTable, at: number): TabCtx {
  const isDesktop = e.surface === 'desktop' && 'Svg' in ui
  const cols = Math.max(24, e.props.bodyColumns || 40)
  return { e, ui, isDesktop, W: Math.max(260, Math.min(900, cols * 8 - 8)), cols, at }
}
