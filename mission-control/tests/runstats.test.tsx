import { expect, test } from 'claude-code/testing'

import { LOG_SRC, OPS_SRC, logStatLine, scoreRows } from '../hooks/features/board'
import { implementerOfLine, issueTime, issueTimeLine, runLogStats } from '../hooks/kit/runstats'
import { fmtSpan } from '../hooks/kit/role'

const NOW = Date.parse('2026-10-22T12:00:00Z')
const DAY = 86_400_000
const line = (daysAgo: number, o: Record<string, unknown>) =>
  JSON.stringify({ ts: new Date(NOW - daysAgo * DAY).toISOString(), source: 'run-log', event: 'run.completed', ...o })

test('run-log runs sum per issue or .ops ticket, all time, with their implementers', () => {
  const src = [
    line(1, { actor: 'codex', issue: 28, detail: { agent: 'codex', durationSec: 1800 } }),
    line(40, { actor: 'codex', issue: 28, event: 'run.failed', detail: { agent: 'codex', durationSec: 1200 } }), // old runs count too
    line(2, { actor: 'x', issue: '#28', detail: { agent: 'antigravity', durationSec: 1800 } }),
    line(1, { actor: 'claude', issue: null, ticket: 'M0-007', detail: { agent: 'claude' } }),
    line(1, { actor: 'codex', issue: 28, event: 'run.started', detail: { agent: 'codex' } }),
    line(1, { actor: 'codex', issue: 28, source: 'hook', detail: { agent: 'codex' } }),
    line(1, { actor: 'codex', detail: { agent: 'codex', durationSec: 60 } }),                // names no ticket
    'not json',
  ].join('\r\n')
  const t = issueTime(src)
  expect(t).toEqual({
    '#28': { runs: 3, sec: 4800, by: { codex: 2, agy: 1 } },
    'M0-007': { runs: 1, sec: 0, by: { claude: 1 } },
  })
  expect(issueTimeLine(t['#28'], fmtSpan)).toBe('3 runs · 1h 20m · Codex 2, agy 1')
  expect(issueTimeLine(t['M0-007'], fmtSpan)).toBe('1 run · Claude 1')
  expect(issueTimeLine(undefined, fmtSpan)).toBe('')
  expect(issueTime('')).toEqual({})
})

test('run-log lines of the last 7 days sum per implementer; other lines are skipped', () => {
  const src = [
    line(1, { actor: 'codex', detail: { agent: 'codex', durationSec: 300 } }),
    line(2, { actor: 'codex', detail: { agent: 'codex', durationSec: 900, exitCode: 2 } }),
    line(3, { actor: 'claude', event: 'run.failed', detail: { agent: 'codex', rateLimited: true } }),
    line(3, { actor: 'x', detail: { agent: 'antigravity', durationSec: 60, reworkCount: 2, result: 'ok' } }),
    line(4, { actor: 'opencode', detail: { result: 'timeout' } }),
    line(8, { actor: 'codex', detail: { agent: 'codex' } }),                // older than 7 days
    line(1, { actor: 'codex', event: 'run.started', detail: { agent: 'codex' } }),
    line(1, { actor: 'codex', source: 'hook', detail: { agent: 'codex' } }),
    line(1, { actor: 'someone', detail: {} }),                              // no implementer
    'not json',
    JSON.stringify({ ts: 'bad', source: 'run-log', event: 'run.completed', actor: 'codex' }),
  ].join('\r\n')
  const s = runLogStats(src, NOW)
  expect(s.map(x => x.agent)).toEqual(['codex', 'agy', 'opencode'])
  expect(s[0]).toEqual({ agent: 'codex', runs: 3, ok: 1, failed: 2, reworks: 0, rateLimited: 1, avgSec: 600 })
  expect(s[1]).toEqual({ agent: 'agy', runs: 1, ok: 1, failed: 0, reworks: 2, rateLimited: 0, avgSec: 60 })
  expect(s[2]).toEqual({ agent: 'opencode', runs: 1, ok: 0, failed: 1, reworks: 0, rateLimited: 0 })
  expect(runLogStats(src, NOW, 30)[0]!.runs).toBe(4)
  expect(runLogStats('', NOW)).toEqual([])
  expect(implementerOfLine('', 'Claude Code')).toBe('claude')
})

test('the scorecard merges run-log and .ops/runs by agent and labels each line', () => {
  const log = runLogStats(line(1, { actor: 'codex', detail: { agent: 'codex', durationSec: 600 } }), NOW)
  expect(logStatLine(log[0]!)).toBe('1 run · 100% ok · avg 10m')
  const rows = scoreRows([{ agent: 'codex', runs: 2, approved: 1, rejected: 1, reworks: 0, rateLimited: 0 }, { agent: 'agy', runs: 1, approved: 1, rejected: 0, reworks: 0, rateLimited: 0 }], log)
  expect(rows.map(r => r.agent)).toEqual(['codex', 'agy'])
  expect(rows[0]!.lines).toEqual([{ src: LOG_SRC, text: '1 run · 100% ok · avg 10m' }, { src: OPS_SRC, text: '2 runs · 50% approved' }])
  expect(rows[1]!.lines.map(l => l.src)).toEqual([OPS_SRC])
  expect(scoreRows([], [])).toEqual([])
})
