// Pure helpers for the Board's scorecard: Mission Control's run-log lines in
// .ops/log/activity.jsonl (`source: "run-log"`, run.completed / run.failed) summed per
// implementer over the last days. No `$` here, so tests exercise them directly.
import type { IssueTime, RunLogStats } from '../../types'

const DAY_MS = 86_400_000
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

// The implementer a run-log line names: its detail.agent, else its actor.
export function implementerOfLine(agent: string, actor: string): string | undefined {
  const who = `${agent} ${actor}`
  return /codex/i.test(who) ? 'codex' : /agy|antigravity/i.test(who) ? 'agy' : /opencode/i.test(who) ? 'opencode' : /claude/i.test(who) ? 'claude' : undefined
}

// A run failed when run-log said so (run.failed), its exit code was not 0, or its result
// reads failed / error / timeout.
const isFailed = (event: string, d: Record<string, unknown>): boolean =>
  event === 'run.failed' || (num(d.exitCode) ?? 0) !== 0 || /^(fail|error|timeout|timed)/i.test(str(d.result))

// One JSON object per line; a line that is not a finished run-log run, or is older than
// `days` before `now`, is skipped. Busiest implementer first.
export function runLogStats(src: string, now: number, days = 7): RunLogStats[] {
  const since = now - days * DAY_MS
  const by = new Map<string, RunLogStats & { secs: number[] }>()
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim()) continue
    let o: unknown
    try { o = JSON.parse(line) } catch { continue }
    if (!isObj(o) || o.source !== 'run-log' || (o.event !== 'run.completed' && o.event !== 'run.failed')) continue
    const at = Date.parse(str(o.ts))
    if (!Number.isFinite(at) || at < since || at > now + DAY_MS) continue
    const d = isObj(o.detail) ? o.detail : {}
    const agent = implementerOfLine(str(d.agent), str(o.actor))
    if (!agent) continue
    const s = by.get(agent) ?? { agent, runs: 0, ok: 0, failed: 0, reworks: 0, rateLimited: 0, secs: [] }
    s.runs++
    if (isFailed(o.event, d)) s.failed++
    else s.ok++
    s.reworks += num(d.reworkCount) ?? 0
    if (d.rateLimited === true) s.rateLimited++
    const sec = num(d.durationSec)
    if (sec && sec > 0) s.secs.push(sec)
    by.set(agent, s)
  }
  return [...by.values()].sort((a, b) => b.runs - a.runs || a.agent.localeCompare(b.agent))
    .map(({ secs, ...s }) => ({ ...s, ...(secs.length ? { avgSec: secs.reduce((n, x) => n + x, 0) / secs.length } : {}) }))
}

// Finished run-log runs per ticket, all time: keyed "#28" for a GitHub issue, else the line's
// .ops ticket id ("M0-007"). Lines that name neither are skipped.
export function issueTime(src: string): Record<string, IssueTime> {
  const out: Record<string, IssueTime> = {}
  for (const line of src.split(/\r?\n/)) {
    if (!line.includes('"run-log"')) continue
    let o: unknown
    try { o = JSON.parse(line) } catch { continue }
    if (!isObj(o) || o.source !== 'run-log' || (o.event !== 'run.completed' && o.event !== 'run.failed')) continue
    const n = typeof o.issue === 'number' ? o.issue : Number(str(o.issue).replace(/^#/, ''))
    const id = Number.isInteger(n) && n > 0 ? `#${n}` : str(o.ticket).trim()
    if (!id) continue
    const d = isObj(o.detail) ? o.detail : {}
    const t = out[id] ?? (out[id] = { runs: 0, sec: 0, by: {} })
    t.runs++
    const sec = num(d.durationSec)
    if (sec && sec > 0) t.sec += sec
    const agent = implementerOfLine(str(d.agent), str(o.actor))
    if (agent) t.by[agent] = (t.by[agent] ?? 0) + 1
  }
  return out
}

const NAMES: Record<string, string> = { codex: 'Codex', agy: 'agy', opencode: 'OpenCode', claude: 'Claude' }

// "3 runs · 1h 20m · Codex 2, agy 1"; empty without runs.
export function issueTimeLine(t: IssueTime | undefined, fmt: (ms: number) => string): string {
  if (!t || t.runs === 0) return ''
  const who = Object.entries(t.by).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([a, n]) => `${NAMES[a] ?? a} ${n}`).join(', ')
  return [`${t.runs} run${t.runs === 1 ? '' : 's'}`, t.sec > 0 ? fmt(t.sec * 1000) : '', who].filter(Boolean).join(' · ')
}
