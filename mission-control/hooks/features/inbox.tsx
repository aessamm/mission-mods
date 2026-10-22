// Waiting on you: what is blocked on the person, in one place. GitHub issues in "Waiting on
// owner" (the board atom), delegations finished and waiting for review, and failed ones (the
// delegations atom). Drawn as rows beneath the status line in the same band above the prompt
// (the hook draws what is beneath it first, so there is never a second band), with a toast
// once per session when owner issues are waiting and again when a new one appears.
// Nothing here calls GitHub or runs git: each button only fills the composer.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { BoardSnapshot, Delegation } from '../../types'
import { clip } from '../kit/chrome'
import { DEFAULT_SETTINGS, settingsOf } from '../kit/state'
import { promptFor } from './delegations'

const board = atom({ plugin: 'mission-control', key: 'board' } as const, null as BoardSnapshot | null)
const delegations = atom({ plugin: 'mission-control', key: 'delegations' } as const, {} as Record<string, Delegation>)
const settings = atom({ plugin: 'mission-control', key: 'settings' } as const, DEFAULT_SETTINGS)
// The band's redraw counter (statusline.tsx bumps it too); Hide bumps it so the rows go at once.
const band = atom({ plugin: 'mission-control', key: 'band' } as const, 0)

const CHECK_MS = 5000
const ROWS = 3

// ---------------------------------------------------------------- pure helpers
export type InboxItem =
  | { kind: 'issue'; key: string; id: string; title: string; prompt: string }
  | { kind: 'review' | 'failed'; key: string; id: string; title: string; prompt: string }

export const issuePrompt = (id: string, title: string): string => `Help me with ${id} ${title}: tell me exactly what I need to do`

// Owner issues first (oldest board order), then failed delegations, then reviews, newest first.
export function inboxItems(snap: BoardSnapshot | null, runs: Record<string, Delegation>): InboxItem[] {
  const issues: InboxItem[] = (snap?.tickets ?? [])
    .filter(t => t.status === 'waiting')
    .map(t => ({ kind: 'issue', key: `issue:${t.id}`, id: t.id, title: t.title, prompt: issuePrompt(t.id, t.title) }))
  const list = Object.values(runs).sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
  const run = (d: Delegation, kind: 'review' | 'failed'): InboxItem => ({
    kind, key: `${kind}:${d.id}`, id: d.ticket ?? d.tool, title: d.task, prompt: promptFor(kind === 'review' ? 'review' : 'fix', d),
  })
  return [
    ...issues,
    ...list.filter(d => d.status === 'failed').map(d => run(d, 'failed')),
    ...list.filter(d => d.status === 'review').map(d => run(d, 'review')),
  ]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// "2 owner issues · 1 to review · 1 failed".
export function inboxSummary(items: InboxItem[]): string {
  const issues = items.filter(i => i.kind === 'issue').length
  const review = items.filter(i => i.kind === 'review').length
  const failed = items.filter(i => i.kind === 'failed').length
  return [
    ...(issues ? [plural(issues, 'owner issue')] : []),
    ...(review ? [`${review} to review`] : []),
    ...(failed ? [`${failed} failed`] : []),
  ].join(' · ')
}

// The toast for owner issues the person has not been told about yet, or undefined.
export function toastFor(items: InboxItem[], told: Set<string>): string | undefined {
  const fresh = items.filter(i => i.kind === 'issue' && !told.has(i.key))
  if (!fresh.length) return undefined
  const all = items.filter(i => i.kind === 'issue').length
  if (!told.size || fresh.length > 1) return `Waiting on you: ${plural(all, 'GitHub issue')} in Waiting on owner. See the line above the prompt.`
  const one = fresh[0]!
  return `New on Waiting on owner: ${one.id} ${clip(one.title, 80)}`
}

// ---------------------------------------------------------------- module state
// Issues already toasted this session (a reload toasts again once), and what Hide put away:
// the band comes back when something new joins.
const told = new Set<string>()
const hidden = { sig: '' }
const sigOf = (items: InboxItem[]) => items.map(i => i.key).sort().join('|')

async function check($: EngineInterface) {
  const s = settingsOf(await read($, settings))
  if (s.show.inbox === false) return
  const items = inboxItems(await read($, board), await read($, delegations))
  const text = toastFor(items, told)
  for (const i of items) if (i.kind === 'issue') told.add(i.key)
  if (text) $.ui.toast(text)
}

// ---------------------------------------------------------------- hooks
export function registerInbox(on: On): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    const started = await next(e)
    void check($).catch(() => undefined)
    $.clock.every(CHECK_MS, () => void check($).catch(() => undefined))
    return started
  })

  // Beneath the status line in the same band: registered just above it, this hook lets the status
  // line (and whatever is beneath) draw first, then adds its rows under that tree.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    await read($, band)
    const s = settingsOf(await read($, settings))
    if (e.props.hasSurvey || s.show.inbox === false) return below
    const items = inboxItems(await read($, board), await read($, delegations))
    if (!items.length || sigOf(items) === hidden.sig) return below
    const { Box, Button, Text } = $.ui.resolve(e)
    const fill = (text: string) => () => void $.prompt.fill({ text, mode: 'replace' })
    const label = (i: InboxItem) => (i.kind === 'issue' ? 'Help me' : i.kind === 'review' ? 'Review diff' : 'Fix it')
    const glyph = (i: InboxItem) => (i.kind === 'issue' ? '⚑' : i.kind === 'review' ? '✓' : '✗')
    const tone = (i: InboxItem) => (i.kind === 'issue' ? 'warning' : i.kind === 'review' ? 'success' : 'error') as 'warning' | 'success' | 'error'
    const shown = items.slice(0, ROWS)
    const room = Math.max(20, (e.props.bodyColumns || 80) - 24)
    const rows: RenderElement[] = shown.map(i => (
      <Box key={`inbox-${i.key}`} flexDirection="row" justifyContent="space-between" alignItems="center" width="100%" gap={1}>
        <Box flexDirection="row" gap={1} flexShrink={1}>
          <Text color={tone(i)}>{glyph(i)}</Text>
          <Text bold>{i.id}</Text>
          <Text wrap="truncate-end">{clip(i.title, room)}</Text>
        </Box>
        <Button key={`inbox-go-${i.key}`} label={label(i)} onPress={fill(i.prompt)} />
      </Box>
    ))
    const mine = (
      <Box key="inbox" flexDirection="column">
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text bold color="warning">Waiting on you</Text>
          <Text dimColor>{inboxSummary(items)}</Text>
          <Button key="inbox-hide" label="Hide" onPress={() => { hidden.sig = sigOf(items); void update($, band, n => (n + 1) % 1_000_000) }} />
        </Box>
        {rows}
        {items.length > shown.length ? <Text dimColor>{`+${items.length - shown.length} more`}</Text> : null}
      </Box>
    )
    return below ? <Box flexDirection="column">{below}{mine}</Box> : mine
  })
}
