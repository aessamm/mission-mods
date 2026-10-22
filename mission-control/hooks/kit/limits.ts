// Which implementers (Codex, agy, OpenCode, Claude) hit a rate limit recently, read from
// Mission Control's run-log lines and from finished relay results. Pure: no `$` here, so
// Delegations and the Board's Start button share it and tests exercise it directly.
import type { Delegation, DelegationTool } from '../../types'

export const LIMIT_WINDOW_MS = 60 * 60_000
// The words run-log.mjs treats as a rate limit.
export const RATE_LIMIT = /rate[ _-]?limit|usage limit|too many requests|\b429\b|quota exceeded|resource[_ ]exhausted/i
// Who to suggest instead, in this order.
const ORDER: DelegationTool[] = ['codex', 'claude', 'agy', 'opencode']
const NAMES: Record<DelegationTool, string> = { codex: 'Codex', agy: 'agy', opencode: 'OpenCode', claude: 'Claude' }

export type LimitHit = { tool: DelegationTool; at: number }
export type Limited = Partial<Record<DelegationTool, { at: number; until: number }>>

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export const toolOf = (who: string): DelegationTool | undefined =>
  /codex/i.test(who) ? 'codex' : /agy|antigravity/i.test(who) ? 'agy' : /opencode/i.test(who) ? 'opencode' : /claude/i.test(who) ? 'claude' : undefined

// A run-log line (`source: "run-log"`) that ended on a rate limit: `detail.rateLimited`, or
// run.failed whose reason reads like one.
export function limitFromLogLine(raw: unknown): LimitHit | null {
  if (!isObj(raw) || raw.source !== 'run-log' || (raw.event !== 'run.completed' && raw.event !== 'run.failed')) return null
  const d = isObj(raw.detail) ? raw.detail : {}
  const hit = d.rateLimited === true || (raw.event === 'run.failed' && RATE_LIMIT.test(`${str(d.reason)} ${str(d.error)}`))
  const tool = toolOf(`${str(d.agent)} ${str(raw.actor)}`)
  const at = Date.parse(str(raw.ts))
  return hit && tool && Number.isFinite(at) ? { tool, at } : null
}

// A relay's result.json that says it was rate limited, flagged or in its words.
export function isLimitedResult(raw: unknown): boolean {
  if (!isObj(raw)) return false
  if (raw.rateLimited === true) return true
  const tail = Array.isArray(raw.stderrTail) ? raw.stderrTail.filter(x => typeof x === 'string').join(' ') : str(raw.stderrTail)
  return RATE_LIMIT.test(`${str(raw.status)} ${str(raw.error)} ${tail} ${str(raw.finalMessage)}`)
}

// Runs this session tracked whose result said so.
export const limitsFromDelegations = (list: Delegation[]): LimitHit[] =>
  list.filter(d => d.rateLimited).map(d => ({ tool: d.tool, at: d.endedAt ?? d.startedAt }))

// Who is limited at `now`, and until when: each tool's latest hit inside the window.
export function limitedAt(hits: LimitHit[], now: number, windowMs = LIMIT_WINDOW_MS): Limited {
  const out: Limited = {}
  for (const h of hits) {
    if (h.at > now || now - h.at >= windowMs) continue
    const had = out[h.tool]
    if (!had || h.at > had.at) out[h.tool] = { at: h.at, until: h.at + windowMs }
  }
  return out
}

// The first implementer that is neither this one nor limited.
export const alternativeTo = (tool: DelegationTool, limited: Limited): DelegationTool | undefined =>
  ORDER.find(t => t !== tool && !limited[t])

// "Codex hit a rate limit 12 min ago; agy is free." Empty when the tool is not limited.
export function limitNote(tool: DelegationTool, limited: Limited, now: number): string {
  const l = limited[tool]
  if (!l) return ''
  const ago = Math.max(1, Math.round((now - l.at) / 60_000))
  const left = Math.max(1, Math.round((l.until - now) / 60_000))
  const alt = alternativeTo(tool, limited)
  return `${NAMES[tool]} hit a rate limit ${ago} min ago (counted as limited for ${left} more min)${alt ? `; ${NAMES[alt]} is free to take it instead` : '; every implementer is limited'}.`
}
