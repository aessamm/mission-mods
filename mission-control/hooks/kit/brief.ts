// Pure helpers for the Board's Start button: who implements a ticket and the delegation
// request that goes in the composer. No `$` here, so tests exercise them directly.
import type { Settings, Ticket } from '../../types'

export type Implementer = { agent: 'codex' | 'claude'; name: string; skill: string; model?: string; effort?: string }

const set = (v: string | undefined) => (v && v !== 'default' ? v : undefined)

// The Builder row of Settings › Agents and models decides: a Claude model there means another
// Claude implements it with that model; anything else, or nothing, means Codex. The row's
// model and effort ride along when they are set.
export function implementerOf(routing: Settings['routing']): Implementer {
  const r = routing.byRole.builder ?? {}
  const model = set(r.model), effort = set(r.effort)
  const isClaude = !!model && /^claude-/i.test(model)
  return {
    agent: isClaude ? 'claude' : 'codex', name: isClaude ? 'Claude' : 'Codex', skill: isClaude ? 'claude-delegate' : 'codex-delegate',
    ...(model ? { model } : {}), ...(effort ? { effort } : {}),
  }
}

// The issue number of a GitHub ticket ("#35" → 35); undefined for an .ops ticket.
export const issueNumberOf = (t: Ticket): number | undefined => {
  const m = /^#(\d+)$/.exec(t.id)
  return m ? Number(m[1]) : undefined
}

// A ready delegation request for one ticket, for the person to read and send.
export function startBrief(t: Ticket, routing: Settings['routing']): string {
  const who = implementerOf(routing)
  const n = issueNumberOf(t)
  const with_ = [who.model ? `model ${who.model}` : '', who.effort ? `effort ${who.effort}` : ''].filter(Boolean).join(', ')
  const runFlags = `--agent ${who.agent} --issue ${n}${who.model ? ` --model ${who.model}` : ''}${who.effort ? ` --effort ${who.effort}` : ''}`
  return [
    `Delegate ${n ? 'GitHub issue' : 'ticket'} ${t.id} "${t.title}" to ${who.name} with /${who.skill}${with_ ? ` (${with_})` : ''}.`,
    t.url ? `Issue: ${t.url}` : '',
    t.labels?.length ? `Labels: ${t.labels.join(', ')}` : '',
    n
      ? `Read the issue for the full brief and its acceptance criteria. If MC_RUN_LOG is set, wrap the relay with Mission Control's run-log so the run joins the board as ${t.id}: \`node "$MC_RUN_LOG" start ${runFlags}\` before it and \`node "$MC_RUN_LOG" end --agent ${who.agent} --issue ${n} --result auto\` after.`
      : `Read ${t.path} for the full brief and its acceptance criteria.`,
    'When it finishes, review the diff and the tests, then wait for my go before merging.',
  ].filter(Boolean).join('\n')
}
