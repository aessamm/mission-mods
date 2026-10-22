// Mission Control's state contract. Every $.state key the mod uses is declared here,
// so each feature module reads and writes against the same shapes.

// ---------------------------------------------------------------- agents
export type AgentAction = { at: number; icon: string; text: string }

export type AgentStatus = 'starting' | 'thinking' | 'writing' | 'tool' | 'idle' | 'done' | 'failed' | 'stopped'

export type AgentRecord = {
  id: string
  callsign: string
  role: string
  emoji: string
  color: string
  description: string
  mission: string
  subagentType: string
  model: string
  effort?: string
  background: boolean
  parentId?: string
  startedAt: number
  endedAt?: number
  status: AgentStatus
  isMain?: boolean     // the session's own agent, not a sub-agent
  nth?: number         // its place among agents of the same role, from 0
  isNamed?: boolean    // Claude gave it a name of its own
  now: { icon: string; text: string }
  steps: number
  tools: number
  files: string[]
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheWrite: number
  contextTokens: number
  costUsd: number
  // Reported by a worker through a step tool (savvy-progress's or ours).
  stepDone?: number
  stepTotal?: number
  stepNote?: string
  // Set by Brain when it routed the model; shown as "Routed: <why>".
  routedWhy?: string
  // Set by Guardrails: last test verdict and blocked-command count for this agent.
  tests?: { passed: number; failed: number }
  blocked?: number
  log: AgentAction[]
  answer?: string
  error?: string
}

// Per-agent live overrides from the Agents tab; applied on the agent's next step.
export type AgentOverride = { model?: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }

// ---------------------------------------------------------------- delegations (Codex, agy, OpenCode)
export type DelegationTool = 'codex' | 'agy' | 'opencode' | 'claude'
export type DelegationStatus = 'running' | 'review' | 'failed' | 'merged' | 'done'

export type Delegation = {
  id: string                 // the Bash tool_use_id that started it
  tool: DelegationTool
  task: string               // first line of the brief, or the ticket title
  ticket?: string            // #28 (a GitHub issue) or M0-007 when the run or its brief names one
  project: string            // repo folder name from --cd
  cwd: string
  branch?: string
  resultPath?: string        // where result.json will appear
  startedAt: number
  endedAt?: number
  status: DelegationStatus
  now: string                // what it is doing / its final line
  files?: number
  added?: number
  removed?: number
  tests?: { passed: number; failed: number; ran: boolean }
  model?: string
  finalMessage?: string
  error?: string
  rateLimited?: boolean      // its result said it hit a rate limit
  limitNote?: string         // set at start when its implementer was limited recently
}

// ---------------------------------------------------------------- board (GitHub issues or .ops/)
// 'waiting' is a GitHub board's "Waiting on owner" column.
export type TicketStatus = 'todo' | 'ready' | 'in_progress' | 'in_review' | 'rework' | 'waiting' | 'done' | 'blocked'
export type Ticket = {
  id: string
  title: string
  status: TicketStatus
  assignee?: string
  milestone?: string
  epic?: string
  tier?: string
  estimate?: string
  dependsOn?: string[]       // depends_on: the tickets this one waits for
  model?: string             // filled at dispatch, e.g. gpt-x / high
  labels?: string[]          // a GitHub issue's labels, prefix dropped ("p1", "ops")
  url?: string               // a GitHub issue's page
  path: string
}
// Where the board's tickets came from: Mission Control's cache of a GitHub repo's issues
// and its project board, or the repo's .ops/tickets.
export type BoardSource = { kind: 'github'; repo: string; board?: string; url?: string; fetchedAt: number } | { kind: 'ops' }
// A line of .ops/memory/DECISIONS.md: "## D-014 — title (2026-09-21)".
export type DecisionNote = { id: string; title: string; date?: string }
// What .ops/runs/<ticket>/*.json says about one agent.
export type AgentRunStats = { agent: string; runs: number; approved: number; rejected: number; reworks: number; avgSec?: number; rateLimited: number }
// Mission Control's run-log runs of one implementer over the last 7 days.
export type RunLogStats = { agent: string; runs: number; ok: number; failed: number; reworks: number; avgSec?: number; rateLimited: number }
// A line of .ops/log/activity.jsonl. `detail` is the line's own words (a string detail, or a
// summary of an object one). Claude Code hook lines (session.started / session.ended /
// subagent.stopped) that come one after another are folded into one event with `hooks` counts.
export type ActivityEvent = {
  ts: string; actor: string; ticket?: string; issue?: number; event: string; detail?: string; from?: string; to?: string
  hooks?: { started: number; ended: number; subagents: number }
}
export type BoardSnapshot = {
  root: string               // repo root that holds .ops/
  project: string
  tickets: Ticket[]
  source?: BoardSource       // absent: .ops (a snapshot from before 0.10)
  activity: ActivityEvent[]  // newest first, at most 30
  decisions?: DecisionNote[] // newest first, at most 3
  agentStats?: AgentRunStats[]
  runLogStats?: RunLogStats[] // run-log runs of the last 7 days, per implementer
  readAt: number
}

// ---------------------------------------------------------------- daily log, standup, handoff, ship
export type LogEntry = { at: number; project: string; kind: 'agent' | 'delegation' | 'ticket' | 'note' | 'session'; text: string; costUsd?: number }
export type DayLog = {
  day: string                // YYYY-MM-DD, local
  entries: LogEntry[]
  sessions: number
  agents: number
  spentUsd: number
}
export type Handoff = { project: string; at: number; text: string }
export type CommandDoc = { kind: 'standup' | 'ship'; at: number; title: string; sections: { heading: string; lines: string[] }[]; extra?: Record<string, string> }

// ---------------------------------------------------------------- budget, alerts, status line
// A plan window as the engine reports it: share used (0–100) and when it resets.
export type PlanWindow = { pct: number; resetsAt?: string }
export type Budget = { day: string; spentToday: number; sessionSpent: number; fiveHour?: PlanWindow; week?: PlanWindow }
// plan: pause at a share of the 5-hour and weekly windows; dollars: a daily spend limit;
// auto: plan when the account has plan windows (a subscription), dollars otherwise.
export type BudgetMode = 'auto' | 'plan' | 'dollars'
export type Alert = { id: string; kind: 'budget' | 'tests' | 'blocked' | 'agent'; tone: 'ok' | 'warn' | 'fail'; label: string; detail?: string; at: number; ratio?: number }

// ---------------------------------------------------------------- settings
export type TabId = 'agents' | 'delegations' | 'board' | 'log' | 'settings' | 'help' | 'info'
export type Settings = {
  show: { agents: boolean; delegations: boolean; board: boolean; log: boolean; statusLine: boolean; toastsAll: boolean; skills: boolean; inbox: boolean }
  budget: { mode: BudgetMode; fiveHourPauseAt: number; weekPauseAt: number; dailyUsd: number; warnAt: number; pauseWhenReached: boolean }
  routing: { auto: boolean; maxAgents: number; byRole: Record<string, { model?: string; effort?: string }> }
  look: { theme: 'follow' | 'light' | 'dark'; agentsLayout: 'cards' | 'focus' | 'lanes'; motion: 'full' | 'calm' | 'off'; names: 'nato' | 'numbers' | 'custom' }
  costumes: Record<string, string>   // role -> costume role key
  agentNames: Record<string, string> // lowercase role (or 'main') -> names, comma separated
  statusLine: StatusLineParts
  boardSource: 'auto' | 'ops' // auto: GitHub issues when Mission Control has them, else .ops/tickets
}

// A Mission Mods mod as Info shows it: built and on, built and off, in the marketplace but
// not installed, or not built yet.
export type FamilyState = 'on' | 'off' | 'available' | 'soon'
export type FamilyMember = { id: string; name: string; what: string; state: FamilyState; version?: string }

// The skills that ship with the mod: yours (a copy you made, never touched), mod (copied
// by Mission Control), missing, or failed (the copy could not be written).
export type CompanionSkill = { name: string; state: 'yours' | 'mod' | 'missing' | 'failed'; where?: string }

// What the status line above the prompt shows, part by part, and how long the prompt cache
// lives (1h on a Claude plan within its usage, 5m with an API key).
export type StatusLineParts = {
  where: boolean; session: boolean; today: boolean; context: boolean; limits: boolean
  lastTurn: boolean; idle: boolean; compactions: boolean; agents: boolean; cacheTtl: '1h' | '5m'
  layout: 'detailed' | 'semi' | 'compact'
  git: 'quiet' | 'chips' | 'full'
}

export type PanelState = {
  tab: TabId
  isCompact: boolean
  isDoneCollapsed: boolean
  expanded: Record<string, boolean>
  focusId?: string
  boardFilter: 'all' | 'mine' | 'agents' | 'blocked'
  boardPick?: string         // the Board ticket whose Start / Open actions show
}

declare module 'claude-code' {
  interface PluginState {
    'mission-control': {
      agents: Record<string, AgentRecord>
      order: string[]
      overrides: Record<string, AgentOverride>
      tick: number
      band: number
      panel: PanelState
      delegations: Record<string, Delegation>
      delegationOrder: string[]
      board: BoardSnapshot | null
      log: DayLog | null
      handoff: Handoff | null
      lastDoc: CommandDoc | null
      budget: Budget
      alerts: Alert[]
      settings: Settings
      family: FamilyMember[] | null
      skills: CompanionSkill[] | null
    }
  }
}
