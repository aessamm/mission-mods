// Settings: the Show, Budget, Agents and models, Look and Characters sections of the
// panel. Every change writes the settings atom and the store, so it lasts across sessions.
// Pattern: this file owns its hooks; its Pane hook draws only when its tab is active.
import { atom, read, update } from 'claude-code'
import { failedView } from '../kit/ui'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { AgentRecord, BoardSnapshot, Delegation, PlanWindow, Settings } from '../../types'
import { activeTab, badgesFrom, tabBar } from '../kit/chrome'
import { avatar, svg, text } from '../kit/draw'
import { divider, onOff, row, section, segmented } from '../kit/ui'
import { DEFAULT_BUDGET, DEFAULT_PANEL, DEFAULT_SETTINGS, STORE, makeCtx, planMode, settingsOf } from '../kit/state'
import type { PaneInput } from '../kit/state'
import type { TabCtx } from '../kit/state'

const agents = atom({ plugin: 'mission-control', key: 'agents' } as const, {} as Record<string, AgentRecord>)
const board = atom({ plugin: 'mission-control', key: 'board' } as const, null as BoardSnapshot | null)
const delegations = atom({ plugin: 'mission-control', key: 'delegations' } as const, {} as Record<string, Delegation>)
const panel = atom({ plugin: 'mission-control', key: 'panel' } as const, DEFAULT_PANEL)
const settings = atom({ plugin: 'mission-control', key: 'settings' } as const, DEFAULT_SETTINGS)
const budget = atom({ plugin: 'mission-control', key: 'budget' } as const, DEFAULT_BUDGET)

type Option = { value: string; label: string }
type Look = Settings['look']

// The seven roles that get a model, effort and costume; keys match settings.routing.byRole and settings.costumes.
const ROLES = [
  { key: 'scout', name: 'Scout', color: '#378ADD', emoji: '🔭' },
  { key: 'architect', name: 'Architect', color: '#7F77DD', emoji: '📐' },
  { key: 'builder', name: 'Builder', color: '#BA7517', emoji: '🛠️' },
  { key: 'reviewer', name: 'Reviewer', color: '#C2558F', emoji: '🧐' },
  { key: 'debugger', name: 'Debugger', color: '#D0453F', emoji: '🐞' },
  { key: 'tester', name: 'Tester', color: '#1D9E75', emoji: '🧪' },
  { key: 'guardian', name: 'Guardian', color: '#5B5FC7', emoji: '🛡️' },
] as const

const COSTUMES: Option[] = [
  'Scout', 'Architect', 'Builder', 'Reviewer', 'Debugger', 'Tester', 'Researcher', 'Scribe', 'Designer',
  'Guardian', 'Refactorer', 'Operator', 'Analyst', 'Guide', 'Agent',
].map(name => ({ value: name.toLowerCase(), label: name }))

const MODELS: Option[] = [
  { value: 'default', label: 'Default' },
  { value: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { value: 'claude-opus-5-5', label: 'Opus 5.5' },
]
const EFFORTS: Option[] = ['default', 'low', 'medium', 'high', 'xhigh', 'max'].map(v => ({
  value: v,
  label: v === 'default' ? 'Default' : v.charAt(0).toUpperCase() + v.slice(1),
}))
// The parts of the status line a person can switch off.
type SlPart = Exclude<keyof Settings['statusLine'], 'cacheTtl' | 'layout' | 'git'>
const SL_PARTS: { id: SlPart; name: string; hint: string }[] = [
  { id: 'where', name: 'Folder and branch', hint: 'Folder, branch, worktree, commits ahead and behind, changed files' },
  { id: 'session', name: 'Session', hint: 'How long it has run, prompts and its cost' },
  { id: 'today', name: 'Today’s spend', hint: 'Added after the session cost' },
  { id: 'context', name: 'Context', hint: 'How full the context window is, in tokens' },
  { id: 'limits', name: 'Plan limits', hint: '5-hour and weekly use, with when each resets' },
  { id: 'lastTurn', name: 'Last turn', hint: 'Its length, model and cache hit' },
  { id: 'idle', name: 'Idle time', hint: 'Since the last reply, marked when the cache goes cold' },
  { id: 'compactions', name: 'Compactions', hint: 'How many, and the last one’s size before and after' },
  { id: 'agents', name: 'Running agents', hint: 'Up to three sub-agents at work, with what each is doing' },
]

// Whose names can be set: the main session, then every role.
const NAMED = [
  { key: 'main', name: 'Main session', costume: 'agent', color: '#D97757' },
  ...ROLES.map(r => ({ key: r.key, name: r.name, costume: r.key, color: r.color })),
]
// The room a text field and its button take in a row, in px.
const INPUT_W = 280
const PAUSE_AT: Option[] = ['50', '60', '70', '75', '80', '85', '90', '95', '100'].map(v => ({ value: v, label: `${v}%` }))
// "1h 18m", "3d 4h" until an ISO time.
const resetIn = (iso: string, now: number): string => {
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
const WARN: Option[] = ['0.5', '0.7', '0.8', '0.9'].map(v => ({ value: v, label: `${Math.round(Number(v) * 100)}%` }))

const SHOW: { id: keyof Settings['show']; name: string; hint: string }[] = [
  { id: 'agents', name: 'Agents', hint: 'Sub-agents with their characters' },
  { id: 'delegations', name: 'Delegations', hint: 'Codex, agy, OpenCode and Claude tasks' },
  { id: 'board', name: 'Board', hint: 'GitHub issues through Mission Control, or .ops/tickets' },
  { id: 'log', name: 'Daily log', hint: 'Saved per project, used by /standup' },
  { id: 'statusLine', name: 'Status line', hint: 'The line above the prompt' },
  { id: 'toastsAll', name: 'Toasts for every finished agent', hint: 'Off: only for agents that need you' },
  { id: 'skills', name: 'Install companion skills', hint: 'Copy the kickoff and delegate skills to ~/.claude/skills when they are missing' },
]

// Dollars from what the person typed: "$8", "8.50", "12,000". Undefined when not a positive amount.
export function parseDollars(v: string): number | undefined {
  const n = Number(v.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined
}

// A route row with one field set; 'default' clears it, so the model or effort falls back to the brain's pick.
export function setRoute(s: Settings, role: string, field: 'model' | 'effort', v: string): Settings {
  const row = { ...s.routing.byRole[role] }
  if (v === 'default') delete row[field]
  else row[field] = v
  return { ...s, routing: { ...s.routing, byRole: { ...s.routing.byRole, [role]: row } } }
}

// The option a select shows: the stored value when it is one of the choices, else Default.
const pick = (opts: Option[], v: string | undefined): string => (opts.some(o => o.value === v) ? (v as string) : 'default')

// Every write goes through here: the atom for the drawing now, the store for the next session.
async function save($: EngineInterface, fn: (s: Settings) => Settings): Promise<void> {
  const next = fn(settingsOf(await read($, settings)))
  await update($, settings, () => next)
  await $.store.set(STORE.settings, next)
}

async function setLimit($: EngineInterface, v: string): Promise<void> {
  const n = parseDollars(v)
  if (n === undefined) {
    $.ui.toast('Enter a daily limit in dollars, like 8')
    return
  }
  await save($, s => ({ ...s, budget: { ...s.budget, dailyUsd: n } }))
}

async function setMax($: EngineInterface, v: string): Promise<void> {
  const n = Math.floor(Number(v.trim()))
  if (!(n >= 1)) {
    $.ui.toast('Enter a number of agents, like 6')
    return
  }
  await save($, s => ({ ...s, routing: { ...s.routing, maxAgents: n } }))
}

// ---------------------------------------------------------------- drawing
// A role's label: its avatar wearing the chosen costume, then its name.
function roleLabel(c: TabCtx, s: Settings, key: string, name: string, color: string, costume: string | undefined, ctrlW: number): RenderElement {
  const { Text } = c.ui
  const Svg = 'Svg' in c.ui ? c.ui.Svg : undefined
  if (!c.isDesktop || !Svg) return <Text key={`rl-${key}`} bold>{name}</Text>
  const w = Math.max(120, c.W - ctrlW - 12)
  const body = avatar(0, 2, 28, key, color, false, false, costume) + text(38, 21, name, { size: 12.5, weight: 600, max: w - 40 })
  return <Svg key={`rl-${key}`} source={svg(w, 32, body, s.look.theme, s.look.motion)} alt={name} width={w} height={32} />
}

// A row whose left side is a role (avatar and name) instead of a name and hint.
function roleRow(c: TabCtx, s: Settings, key: string, label: RenderElement, controls: RenderElement[], ctrlW = 0): RenderElement {
  const { Box } = c.ui
  // Narrow pane: the controls go under the role, on a line of their own.
  const isStacked = ctrlW > 0 && c.W - ctrlW < 200
  return (
    <Box key={`role-${key}`} flexDirection="column">
      {isStacked ? (
        <>
          {label}
          <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap" marginTop={1} marginBottom={1}>{controls}</Box>
        </>
      ) : (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          {label}
          <Box flexDirection="row" gap={1} alignItems="center">{controls}</Box>
        </Box>
      )}
      {divider(c, s.look, key)}
    </Box>
  )
}

// ---------------------------------------------------------------- the tab
async function renderSettings($: EngineInterface, c: TabCtx, s: Settings): Promise<RenderElement> {
  const { ui } = c
  const { Box, Button } = ui
  const Select = 'Select' in ui ? ui.Select : undefined
  const Input = 'Input' in ui ? ui.Input : undefined
  const look = s.look
  const set = (fn: (x: Settings) => Settings) => void save($, fn)
  const costumeName = (key: string) => COSTUMES.find(o => o.value === key)?.label ?? key
  const b = { ...DEFAULT_BUDGET, ...(await read($, budget)) }
  const hasPlan = b.fiveHour !== undefined || b.week !== undefined
  const isPlan = planMode(s, b)
  const windowHint = (w: PlanWindow | undefined) => (w ? `Now ${Math.round(w.pct)}% used${w.resetsAt ? ` · resets in ${resetIn(w.resetsAt, c.at)}` : ''}` : 'This account reports no such window')

  return (
    <Box flexDirection="column">
      {section(c, look, 'show', 'Panel', 'Turn each part of Mission Control on or off.', true)}
      {SHOW.map(r => row(c, look, `show-${r.id}`, r.name, r.hint, 150,
        onOff(c, `show-${r.id}`, s.show[r.id], v => set(x => ({ ...x, show: { ...x.show, [r.id]: v } })))))}
      {row(c, look, 'board-source', 'Board reads', s.boardSource === 'ops' ? 'Tickets from .ops/tickets only' : 'GitHub issues from Mission Control’s cache when this repo has one, else .ops/tickets', 260,
        segmented(c, 'board-source', [['auto', 'GitHub, else .ops'], ['ops', '.ops only']], s.boardSource, v => set(x => ({ ...x, boardSource: v as Settings['boardSource'] }))))}

      {section(c, look, 'statusline', 'Status line', s.show.statusLine ? 'Choose what the line above the prompt shows.' : 'The status line is off. Pick a layout below to show it again.')}
      {row(c, look, 'sl-layout', 'Layout', !s.show.statusLine ? 'Hidden: no line above the prompt. Pick a layout to bring it back' : s.statusLine.layout === 'compact' ? 'One line: where, the meters, cost and agents' : s.statusLine.layout === 'semi' ? 'Two lines: where and session, then the meters and agents' : 'Several lines with every part you keep on', 360,
        segmented(c, 'sl-layout', [['detailed', 'Detailed'], ['semi', 'Semi-compact'], ['compact', 'Compact'], ['off', 'Off']], s.show.statusLine ? s.statusLine.layout : 'off',
          v => set(x => v === 'off'
            ? { ...x, show: { ...x.show, statusLine: false } }
            : { ...x, show: { ...x.show, statusLine: true }, statusLine: { ...x.statusLine, layout: v as Settings['statusLine']['layout'] } })))}
      {row(c, look, 'sl-git', 'Git style', s.statusLine.git === 'quiet' ? 'One line of text: branch, ahead and behind, changed files' : s.statusLine.git === 'full' ? 'Chips, plus a line with staged, modified, untracked, conflicts, stashes and the last commit' : 'Branch and changes as chips: staged, modified, untracked', 260,
        segmented(c, 'sl-git', [['quiet', 'Quiet'], ['chips', 'Chips'], ['full', 'Full']], s.statusLine.git, v => set(x => ({ ...x, statusLine: { ...x.statusLine, git: v as Settings['statusLine']['git'] } }))))}
      {SL_PARTS.map(r => row(c, look, `sl-${r.id}`, r.name, r.hint, 150,
        onOff(c, `sl-${r.id}`, s.statusLine[r.id], v => set(x => ({ ...x, statusLine: { ...x.statusLine, [r.id]: v } })))))}
      {row(c, look, 'sl-ttl', 'Prompt cache lasts', 'When idle time passes this, the line marks the cache cold. 1 hour on a Claude plan, 5 minutes with an API key', 160,
        segmented(c, 'sl-ttl', [['1h', '1 hour'], ['5m', '5 min']], s.statusLine.cacheTtl, v => set(x => ({ ...x, statusLine: { ...x.statusLine, cacheTtl: v as '1h' | '5m' } }))))}

      {section(c, look, 'budget', 'Budget', isPlan ? 'Follows your plan: how much of the 5-hour and weekly windows is used.' : 'A daily limit in dollars, across every session.')}
      {row(c, look, 'budget-mode', 'Budget follows', hasPlan ? 'Auto picks your plan, since this account has plan windows' : 'Auto picks dollars, since this account has no plan windows', 270,
        segmented(c, 'budget-mode', [['auto', 'Auto'], ['plan', 'Plan limits'], ['dollars', 'Dollars']], s.budget.mode, v => set(x => ({ ...x, budget: { ...x.budget, mode: v as Settings['budget']['mode'] } }))))}
      {isPlan && row(c, look, 'budget-5h', 'Pause at, 5-hour window', windowHint(b.fiveHour), 100,
        Select ? <Select key="budget-5h" value={String(s.budget.fiveHourPauseAt)} options={PAUSE_AT} onSelect={v => set(x => ({ ...x, budget: { ...x.budget, fiveHourPauseAt: Number(v) } }))} /> : [])}
      {isPlan && row(c, look, 'budget-week', 'Pause at, weekly window', windowHint(b.week), 100,
        Select ? <Select key="budget-week" value={String(s.budget.weekPauseAt)} options={PAUSE_AT} onSelect={v => set(x => ({ ...x, budget: { ...x.budget, weekPauseAt: Number(v) } }))} /> : [])}
      {!isPlan && row(c, look, 'budget-limit', 'Daily limit', `In dollars, across every session · ≈$${b.spentToday.toFixed(2)} today`, INPUT_W,
        Input ? <Input key="budget-limit" label="$" value={s.budget.dailyUsd.toFixed(2)} submitLabel="Set" onSubmit={v => setLimit($, v)} /> : [])}
      {row(c, look, 'budget-warn', 'Warn from', isPlan ? 'A toast and an amber bar from this share of the pause point' : 'A toast and an amber bar from this share of the limit', 100,
        Select ? <Select key="budget-warn" value={pick(WARN, String(s.budget.warnAt))} options={WARN} onSelect={v => set(x => ({ ...x, budget: { ...x.budget, warnAt: Number(v) } }))} /> : [])}
      {row(c, look, 'budget-pause', 'Pause new agents at the limit', 'New sub-agents are refused until it resets or you raise it', 150,
        onOff(c, 'budget-pause', s.budget.pauseWhenReached, v => set(x => ({ ...x, budget: { ...x.budget, pauseWhenReached: v } }))))}

      {section(c, look, 'models', 'Agents and models', 'The model and effort each role starts with. Default lets Claude choose.')}
      {ROLES.map(r => {
        const rt = s.routing.byRole[r.key] ?? {}
        return roleRow(c, s, `route-${r.key}`, roleLabel(c, s, r.key, r.name, r.color, s.costumes[r.key], 260), Select ? [
          <Select key={`model-${r.key}`} value={pick(MODELS, rt.model)} options={MODELS} onSelect={v => set(x => setRoute(x, r.key, 'model', v))} />,
          <Select key={`effort-${r.key}`} value={pick(EFFORTS, rt.effort)} options={EFFORTS} onSelect={v => set(x => setRoute(x, r.key, 'effort', v))} />,
        ] : [])
      })}
      {row(c, look, 'route-auto', 'Route models automatically', 'Needs Brain. Your choices above always win.', 150,
        onOff(c, 'route-auto', s.routing.auto, v => set(x => ({ ...x, routing: { ...x.routing, auto: v } }))))}
      {row(c, look, 'route-max', 'Ask before more than', 'Agents running at once', INPUT_W,
        Input ? <Input key="route-max" value={String(s.routing.maxAgents)} submitLabel="Set" onSubmit={v => setMax($, v)} /> : [])}

      {section(c, look, 'look', 'Look')}
      {row(c, look, 'look-theme', 'Theme', 'Follow Claude matches the app', 260,
        segmented(c, 'theme', [['follow', 'Follow Claude'], ['light', 'Light'], ['dark', 'Dark']], look.theme, v => set(x => ({ ...x, look: { ...x.look, theme: v as Look['theme'] } }))))}
      {row(c, look, 'look-layout', 'Agents layout', undefined, 230,
        segmented(c, 'layout', [['cards', 'Cards'], ['focus', 'Focus'], ['lanes', 'Lanes']], look.agentsLayout, v => set(x => ({ ...x, look: { ...x.look, agentsLayout: v as Look['agentsLayout'] } }))))}
      {row(c, look, 'look-motion', 'Motion', 'Walking crabs and animated bubbles', 200,
        segmented(c, 'motion', [['full', 'Full'], ['calm', 'Calm'], ['off', 'Off']], look.motion, v => set(x => ({ ...x, look: { ...x.look, motion: v as Look['motion'] } }))))}

      {section(c, look, 'names', 'Names', 'What each agent is called in the panel, toasts and the status line.')}
      {row(c, look, 'names-style', 'Name style', look.names === 'custom' ? 'Shown as Omar - (Tester). Separate several names with commas; new agents take them in turn' : look.names === 'numbers' ? 'Shown as Tester 1, Tester 2' : 'Shown as Tester Alpha, Tester Bravo', 290,
        segmented(c, 'names', [['nato', 'Tester Alpha'], ['numbers', 'Tester 1'], ['custom', 'My names']], look.names, v => set(x => ({ ...x, look: { ...x.look, names: v as Look['names'] } }))))}
      {look.names === 'custom' && NAMED.map(r => roleRow(c, s, `name-${r.key}`, roleLabel(c, s, r.costume, r.name, r.color, s.costumes[r.costume], c.W - INPUT_W < 200 ? 0 : INPUT_W), Input ? [
        <Input key={`names-${r.key}`} value={s.agentNames[r.key] ?? ''} placeholder={r.key === 'main' ? 'Claude' : 'Omar, Sara'} submitLabel="Save" onSubmit={v => set(x => ({ ...x, agentNames: { ...x.agentNames, [r.key]: v.split(',').map(n => n.trim()).filter(Boolean).join(', ') } }))} />,
      ] : [], INPUT_W))}

      {section(c, look, 'cast', 'Characters', 'The costume each role wears in the panel.')}
      {ROLES.map(r => roleRow(c, s, `cast-${r.key}`, roleLabel(c, s, r.key, r.name, r.color, s.costumes[r.key], 150), Select ? [
        <Select key={`costume-${r.key}`} value={s.costumes[r.key] ?? r.key} options={COSTUMES} onSelect={v => set(x => ({ ...x, costumes: { ...x.costumes, [r.key]: v } }))} />,
      ] : [<Box key={`c-${r.key}`}>{costumeName(s.costumes[r.key] ?? r.key)}</Box>]))}
      <Box flexDirection="row" justifyContent="flex-end" marginTop={1}>
        <Button key="costumes-reset" label="Reset characters" dimColor onPress={() => set(x => ({ ...x, costumes: {} }))} />
      </Box>
    </Box>
  )
}

export function registerSettings(on: On): void {
  on('ui.render', { component: 'Pane', requestId: 'mission-control' }, async ($, e, next) => {
    const p = { ...DEFAULT_PANEL, ...(await read($, panel)) }
    const s = settingsOf(await read($, settings))
    if (activeTab(p.tab, s) !== 'settings') return next(e)
    const ui = $.ui.resolve(e)
    const c = makeCtx(e, ui, await $.clock.now())
    const { Box } = ui
    const badges = badgesFrom(await read($, agents), await read($, delegations), await read($, board))
    return (
      <Box flexDirection="column" gap={1}>
        {tabBar(ui, 'settings', badges, s, t => void update($, panel, q => ({ ...q, tab: t })), c.isDesktop ? c.W : 0, c.at)}
        {await renderSettings($, c, s)}
      </Box>
    )
  }).catch(($, e, next) => paneFailed($, e, next.error, 'settings'))
}

// When drawing fails, say so in the pane (and keep the reason for a bug report) instead of
// leaving it blank.
async function paneFailed($: EngineInterface, e: PaneInput, error: unknown, where: string): Promise<RenderElement> {
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : JSON.stringify(error)
  await $.store.set('lastError', { where, reason, at: await $.clock.now() }).catch(() => undefined)
  return failedView($.ui.resolve(e), where, reason)
}
