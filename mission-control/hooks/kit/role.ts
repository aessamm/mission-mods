// Pure helpers: who an agent is (role, avatar, color, callsign), how its
// activity reads, and what it costs. No `$` here, so tests exercise them directly.

export type Role = {
  role: string
  emoji: string
  color: string
  // Steps a typical run of this role takes; drives the progress estimate.
  expectedSteps: number
}

// Muted tones, one per role, readable on light and dark backgrounds.
const ROLES = {
  scout: { role: 'Scout', emoji: '🔭', color: '#378ADD', expectedSteps: 12 },
  architect: { role: 'Architect', emoji: '📐', color: '#7F77DD', expectedSteps: 14 },
  builder: { role: 'Builder', emoji: '🛠️', color: '#BA7517', expectedSteps: 30 },
  reviewer: { role: 'Reviewer', emoji: '🧐', color: '#C2558F', expectedSteps: 18 },
  debugger: { role: 'Debugger', emoji: '🐞', color: '#D0453F', expectedSteps: 25 },
  tester: { role: 'Tester', emoji: '🧪', color: '#1D9E75', expectedSteps: 22 },
  researcher: { role: 'Researcher', emoji: '📚', color: '#2A9A9A', expectedSteps: 16 },
  scribe: { role: 'Scribe', emoji: '✍️', color: '#A88A1C', expectedSteps: 14 },
  designer: { role: 'Designer', emoji: '🎨', color: '#B7509B', expectedSteps: 20 },
  guardian: { role: 'Guardian', emoji: '🛡️', color: '#5B5FC7', expectedSteps: 20 },
  refactorer: { role: 'Refactorer', emoji: '♻️', color: '#3B9C5F', expectedSteps: 24 },
  operator: { role: 'Operator', emoji: '🚀', color: '#D85A30', expectedSteps: 18 },
  analyst: { role: 'Analyst', emoji: '📊', color: '#2F7FB8', expectedSteps: 16 },
  guide: { role: 'Guide', emoji: '🧭', color: '#6E9A2C', expectedSteps: 10 },
  agent: { role: 'Agent', emoji: '🤖', color: '#888780', expectedSteps: 20 },
} satisfies Record<string, Role>

type RoleKey = keyof typeof ROLES

// Agent types that say outright what the agent is for.
const BY_TYPE: Partial<Record<string, RoleKey>> = {
  explore: 'scout',
  plan: 'architect',
  'claude-code-guide': 'guide',
  'statusline-setup': 'designer',
}

// The rule that matches earliest in the text wins; a tie goes to the higher row.
const BY_WORDS: Array<[RoleKey, RegExp]> = [
  ['guardian', /\b(security|vuln\w*|auth|authn|authz|authenticat\w*|authoriz\w*|permissions?|secrets?|cves?)\b|أمان|ثغر/i],
  ['debugger', /\b(debug\w*|bugs?|crash\w*|errors?|exceptions?|stack ?traces?|failing|broken|fix\w*)\b|خطأ|مشكلة/i],
  ['tester', /\b(tests?|testing|specs?|coverage|e2e|unit|qa|verify)\b|اختبار|تست/i],
  ['reviewer', /\b(review\w*|audit\w*|critique|inspect\w*|check quality|lint\w*)\b|مراجع|راجع/i],
  ['refactorer', /\b(refactor|clean ?up|simplif|restructure|migrat)\w*|إعادة هيكلة/i],
  ['architect', /\b(plan|design doc|architect|strategy|approach|spec out)\w*|خطة|معمار/i],
  ['designer', /\b(ui|ux|css|style|layout|figma|design|theme|frontend)\b|تصميم|واجهة/i],
  ['scribe', /\b(write\s+(the\s+|some\s+)?(docs?|readme|documentation|changelog)|docs?|readme|documentation|document\w*|write ?up|changelog|summar\w*)\b|توثيق|اكتب/i],
  ['operator', /\b(deploy\w*|ci|cd|docker\w*|k8s|kubernetes|releases?|pipelines?|infra\w*)\b|نشر/i],
  ['analyst', /\b(analy[sz]e|metrics|data|report|benchmark|profile|perf)\w*|تحليل/i],
  ['researcher', /\b(research|investigate|docs lookup|web|compare|evaluate)\w*|ابحث|بحث/i],
  ['scout', /\b(find|search|locate|explore|map|where|scan|grep|list)\w*|استكشف|دور/i],
  ['builder', /\b(implement|build|create|add|write|make|scaffold|generate)\w*|ابني|نفذ/i],
]

function earliest(text: string): RoleKey | undefined {
  let best: RoleKey | undefined
  let at = Infinity
  for (const [key, re] of BY_WORDS) {
    const i = text.search(re)
    if (i >= 0 && i < at) {
      best = key
      at = i
    }
  }
  return best
}

// The description decides first; the prompt only when the description says nothing.
export function roleOf(subagentType: string, description: string, prompt: string): Role {
  const typed = BY_TYPE[subagentType.toLowerCase()]
  if (typed) return ROLES[typed]
  const key = earliest(description) ?? earliest(prompt.slice(0, 400))
  return key ? ROLES[key] : ROLES.agent
}

export function expectedStepsOf(role: string): number {
  const found = Object.values(ROLES).find(r => r.role === role)
  return (found ?? ROLES.agent).expectedSteps
}

const CALLSIGNS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'Nova', 'Orion', 'Pulsar']

// "Scout Alpha", "Scout Bravo": the nth agent of a role this session.
export function callsignOf(role: string, nth: number): string {
  const word = CALLSIGNS[nth % CALLSIGNS.length]
  const lap = Math.floor(nth / CALLSIGNS.length)
  return `${role} ${word}${lap > 0 ? ` ${lap + 1}` : ''}`
}

const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const clip = (s: string, n: number) => {
  const chars = [...s.replace(/\s+/g, ' ').trim()]
  return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : chars.join('')
}
const named = (verb: string, file: string) => (file ? `${verb} ${base(file)}` : verb)

// The part of a shell line worth reading: past variable assignments and `cd`,
// with long paths cut to their last name (`F="C:/a/b/x.tsx"; sed …` → `sed …`).
export function commandOf(command: string): string {
  const parts = command.split(/\s*(?:&&|\|\||;|\n)\s*/).map(s => s.trim()).filter(Boolean)
  const real = parts.find(s => !/^[A-Za-z_]\w*=/.test(s) && !/^cd\s/.test(s)) ?? parts[0] ?? command
  return real.replace(/(^|[\s=])(["']?)(?:[A-Za-z]:)?(?:[\\/][^\s"'\\/]+){2,}[\\/]([^\s"'\\/]+)\2/g, '$1…/$3')
}

// What a tool call reads as on the card: an icon and a short sentence.
export function describeTool(tool: string, input: Record<string, unknown>): { icon: string; text: string; file?: string } {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const file = str('file_path') || str('notebook_path')
  switch (tool) {
    case 'Read':
      return { icon: '📖', text: named('Reading', file), file }
    case 'Edit':
    case 'MultiEdit':
      return { icon: '✏️', text: named('Editing', file), file }
    case 'Write':
      return { icon: '📝', text: named('Writing', file), file }
    case 'NotebookEdit':
      return { icon: '📓', text: named('Editing notebook', file), file }
    case 'Grep':
      return { icon: '🔍', text: `Searching “${clip(str('pattern'), 40)}”` }
    case 'Glob':
      return { icon: '🗂️', text: `Listing ${clip(str('pattern'), 40)}` }
    case 'Bash':
    case 'PowerShell':
      return { icon: '⚡', text: `Running ${clip(str('description') || commandOf(str('command')), 60)}` }
    case 'WebFetch':
      return { icon: '🌐', text: `Fetching ${clip(str('url').replace(/^https?:\/\//, ''), 50)}` }
    case 'WebSearch':
      return { icon: '🔎', text: `Web search “${clip(str('query'), 40)}”` }
    case 'Agent':
    case 'Task':
      return { icon: '🧬', text: `Spawning helper: ${clip(str('description'), 40)}` }
    case 'TodoWrite':
      return { icon: '✅', text: 'Updating its todo list' }
    case 'Skill':
      return { icon: '🎓', text: `Loading skill ${str('skill')}` }
    case 'ToolSearch':
      return { icon: '🧰', text: 'Looking up tools' }
    default: {
      const short = tool.startsWith('mcp__') ? tool.split('__').slice(1).join(' › ') : tool
      return { icon: '🔧', text: `Using ${clip(short, 50)}` }
    }
  }
}

export function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(Math.round(n))
}

// m:ss, or h:mm:ss past an hour.
export function fmtTime(ms: number): string {
  const s = Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// A running span to the minute: "<1m", "4m", "1h 12m". Live clocks use it so the panel
// and the band redraw once a minute at most for time alone.
export function fmtSpan(ms: number): string {
  const m = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0
  if (m < 1) return '<1m'
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}
// How long ago, to the minute.
export const fmtAgo = (ms: number) => (ms < 60_000 ? 'just now' : `${fmtSpan(ms)} ago`)

export function fmtCost(usd: number): string {
  return `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`
}

// An estimate, never a measurement: climbs with model steps against what the
// role usually needs and holds at 95% until the agent actually finishes.
export function estimateOf(steps: number, expected: number, isFinished: boolean): number {
  if (isFinished) return 1
  return Math.min(0.95, 1 - Math.exp(-steps / (expected / 2)))
}

// USD per million tokens: input, output, cache read, cache write. The engine
// reports tokens, not money, so every cost the panel shows is an estimate.
// Rates are the ones savvy-progress uses, so the two panels agree.
const PRICES: Array<[RegExp, [number, number, number, number]]> = [
  [/fable|mythos/, [10, 50, 0.25, 12.5]],
  [/opus-5-5/, [4, 20, 0.2, 5]],
  [/opus/, [5, 25, 0.5, 6.25]],
  [/sonnet/, [2, 10, 0.2, 2.5]],
  [/haiku/, [1, 5, 0.1, 1.25]],
]

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export function costOf(model: string, u: Usage): number {
  const [i, o, r, w] = PRICES.find(([re]) => re.test(model.toLowerCase()))?.[1] ?? [4, 20, 0.2, 5]
  return ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_read_input_tokens || 0) * r + (u.cache_creation_input_tokens || 0) * w) / 1e6
}

export function windowOf(model: string): number {
  return /haiku/i.test(model) ? 200_000 : 1_000_000
}

export function modelName(id: string): string {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}

export function bar(ratio: number, width: number): string {
  const w = Math.max(6, width)
  const full = Math.round(Math.min(1, Math.max(0, ratio)) * w)
  return '█'.repeat(full) + '░'.repeat(w - full)
}
