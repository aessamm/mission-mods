// The words a Delegations button puts in the composer, shared by the Delegations tab and the
// inbox. Pure: no $, and nothing here runs git.
import type { Delegation, DelegationTool } from '../../types'
import { clip } from './chrome'

export const TOOLS: Record<DelegationTool, { name: string; color: string }> = {
  codex: { name: 'Codex', color: '#1f1f1f' },
  agy: { name: 'agy', color: '#378add' },
  opencode: { name: 'OpenCode', color: '#ba7517' },
  claude: { name: 'Claude', color: '#d97757' },
}

export const firstLine = (s: string): string => s.split('\n').find(l => l.trim() !== '')?.trim() ?? ''
export const toolLabel = (d: Delegation): string => TOOLS[d.tool]?.name ?? d.tool

// The prompts the buttons put in the composer.
export function promptFor(kind: 'retry' | 'fix' | 'review' | 'merge' | 'branch', d: Delegation): string {
  const where = `${d.branch ? `on ${d.branch} ` : ''}in ${d.cwd}`
  const who = toolLabel(d)
  switch (kind) {
    case 'retry':
      return `Retry the ${who} delegation "${d.task}" in ${d.cwd}. ${d.resultPath ? `Read ${d.resultPath} to see why it failed, then` : 'Find out why it failed, then'} dispatch it again with the same brief${d.model ? ` and model ${d.model}` : ''}.`
    case 'fix':
      return `${who} failed on "${d.task}" ${where}${d.error ? ` (${clip(firstLine(d.error), 160)})` : ''}. Look at what it left behind and fix it here yourself instead of delegating again.`
    case 'review':
      return `Review the diff from ${who} ${where} and tell me if it is ready to merge.`
    case 'merge':
      return `If the diff from ${who} ${where} passes review and its tests are green, show me the merge plan for "${d.task}" and wait for my go before running anything.`
    case 'branch':
      return `Show me how to open ${d.branch ? `the branch ${d.branch}` : `the ${who} working tree`} in ${d.cwd} so I can look at the changes myself.`
  }
}
