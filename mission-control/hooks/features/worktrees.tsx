// Worktrees: every worktree of the session's repo, read with read-only git. Its own tab,
// since it lists branches on disk, which neither the Board (issues) nor Delegations (runs)
// shows. Git runs when the tab opens and on a slow clock while it stays open; a render only
// reads the snapshot. Buttons fill the composer; the mod never runs a git write.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { AgentRecord, BoardSnapshot, Delegation, Settings, Worktree, WorktreeSnapshot } from '../../types'
import { activeTab, badgesFrom, clip, tabBar } from '../kit/chrome'
import { chip, hline, text, textWidth, wide } from '../kit/draw'
import { samePath } from '../kit/paths'
import { DEFAULT_PANEL, DEFAULT_SETTINGS, makeCtx, settingsOf } from '../kit/state'
import type { PaneInput, TabCtx } from '../kit/state'
import { emptyState, failedView } from '../kit/ui'
import { ago, issueOf, landPrompt, parseLog, parseStatus, parseWorktreeList, removePrompt, sessionPrompt, shortPath, syncOf } from '../kit/worktrees'

const agents = atom({ plugin: 'mission-control', key: 'agents' } as const, {} as Record<string, AgentRecord>)
const delegations = atom({ plugin: 'mission-control', key: 'delegations' } as const, {} as Record<string, Delegation>)
const board = atom({ plugin: 'mission-control', key: 'board' } as const, null as BoardSnapshot | null)
const worktrees = atom({ plugin: 'mission-control', key: 'worktrees' } as const, null as WorktreeSnapshot | null)
const panel = atom({ plugin: 'mission-control', key: 'panel' } as const, DEFAULT_PANEL)
const settings = atom({ plugin: 'mission-control', key: 'settings' } as const, DEFAULT_SETTINGS)

const POLL_MS = 3000        // how often the clock looks at which tab is open (a state read, no git)
const STALE_MS = 60_000     // while the tab is open, git runs again after this long
const GIT_MS = 5000
const MAX_TREES = 40
type Theme = 'follow' | 'light' | 'dark'
type Motion = 'full' | 'calm' | 'off'

// Module memory: one read at a time, and the tab seen on the last clock tick.
const loader = { busy: false, lastTab: '' }

async function git($: EngineInterface, cwd: string, args: string[]): Promise<string | null> {
  const r = await $.process.run(['git', ...args], { cwd, timeoutMs: GIT_MS }).catch(() => null)
  return r && r.exitCode === 0 ? r.stdout : null
}

async function readTree($: EngineInterface, e: ReturnType<typeof parseWorktreeList>[number], i: number, base: string, here: string): Promise<Worktree> {
  const isMain = i === 0
  const w: Worktree = {
    path: e.path, name: shortPath(e.path, isMain), isMain, isCurrent: samePath(e.path, here),
    isLocked: e.isLocked, isPrunable: e.isPrunable, ...(e.branch ? { branch: e.branch } : {}),
  }
  if (e.isPrunable || e.isBare) return w
  const [status, last, own] = await Promise.all([
    git($, e.path, ['status', '--porcelain=v2', '--branch']),
    git($, e.path, ['log', '-1', '--format=%h%x09%ct%x09%s']),
    // The branch's own commits, for the issue its subjects name; the main worktree has none apart.
    isMain || !base ? Promise.resolve('') : git($, e.path, ['log', '-10', '--format=%h%x09%ct%x09%s', `${base}..HEAD`]),
  ])
  if (status === null && last === null) return { ...w, error: 'git could not read this worktree' }
  const st = parseStatus(status ?? '')
  const head = parseLog(last ?? '')[0]
  const issue = issueOf(e.branch, parseLog(own ?? '').map(c => c.subject))
  return {
    ...w, changes: st.changes,
    ...(st.upstream ? { upstream: st.upstream } : {}),
    ...(st.ahead !== undefined ? { ahead: st.ahead, behind: st.behind } : {}),
    ...(head ? { sha: head.sha, subject: head.subject, committedAt: head.at } : {}),
    ...(issue ? { issue } : {}),
  }
}

async function loadWorktrees($: EngineInterface): Promise<void> {
  if (loader.busy) return
  loader.busy = true
  try {
    const here = (await $.session.cwd()).replace(/\\/g, '/')
    const repo = await $.session.repo().catch(() => null)
    const root = (repo?.root ?? here).replace(/\\/g, '/')
    const at = await $.clock.now()
    const list = await git($, root, ['worktree', 'list', '--porcelain'])
    if (list === null) {
      await update($, worktrees, () => ({ root, base: '', items: [], readAt: at, error: 'Not a git repository, or git is not on the path.' }))
      return
    }
    const entries = parseWorktreeList(list).slice(0, MAX_TREES)
    const base = entries[0]?.branch ?? ''
    // A few at a time: the owner keeps many worktrees, and each takes three git calls.
    const items: Worktree[] = []
    for (let i = 0; i < entries.length; i += 4) {
      items.push(...await Promise.all(entries.slice(i, i + 4).map((en, j) => readTree($, en, i + j, base, here))))
    }
    const snap: WorktreeSnapshot = { root, base, items, readAt: at }
    const was = await read($, worktrees)
    const key = (s: WorktreeSnapshot | null) => JSON.stringify(s ? [s.root, s.base, s.items, s.error ?? ''] : null)
    // The same worktrees: keep the old snapshot, so the tab does not redraw for nothing.
    if (key(was) !== key(snap)) await update($, worktrees, () => snap)
  } finally {
    loader.busy = false
  }
}

export function registerWorktrees(on: On): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    const started = await next(e)
    // A cheap look at which tab is open; git only runs when the Worktrees tab has just opened,
    // or has been open for STALE_MS since the last read.
    $.clock.every(POLL_MS, () => void (async () => {
      const s = settingsOf(await read($, settings))
      const tab = activeTab({ ...DEFAULT_PANEL, ...(await read($, panel)) }.tab, s)
      const opened = tab === 'worktrees' && loader.lastTab !== 'worktrees'
      loader.lastTab = tab
      if (tab !== 'worktrees') return
      const snap = await read($, worktrees)
      if (opened || !snap || (await $.clock.now()) - snap.readAt >= STALE_MS) await loadWorktrees($)
    })().catch(() => undefined))
    return started
  })

  // The tab opening, by its button or /mission worktrees: read now rather than on the next
  // clock tick. A render only reads; git never runs from one.
  on('ui.press', { plugin: 'mission-control', element: 'tab-worktrees' }, async ($, e, next) => {
    const wasOpen = activeTab({ ...DEFAULT_PANEL, ...(await read($, panel)) }.tab, settingsOf(await read($, settings))) === 'worktrees'
    loader.lastTab = 'worktrees'
    if (!wasOpen) void loadWorktrees($).catch(() => undefined)
    return next(e)
  })
  on('command.run', { command: 'mission' }, async ($, e, next) => {
    const r = await next(e)
    if (String(e.args ?? '').trim().toLowerCase() === 'worktrees') {
      loader.lastTab = 'worktrees'
      void loadWorktrees($).catch(() => undefined)
    }
    return r
  })

  on('ui.render', { component: 'Pane', requestId: 'mission-control' }, async ($, e, next) => {
    const p = { ...DEFAULT_PANEL, ...(await read($, panel)) }
    const s = settingsOf(await read($, settings))
    if (activeTab(p.tab, s) !== 'worktrees') return next(e)
    const ui = $.ui.resolve(e)
    const c = makeCtx(e, ui, await $.clock.now())
    const { Box, Text } = ui
    const snap = await read($, worktrees)
    const badges = badgesFrom(await read($, agents), await read($, delegations), await read($, board))
    const fill = (t: string) => void $.prompt.fill({ text: t, mode: 'replace' }).catch(() => undefined)
    const acts: TreeActs = {
      pick: p.worktreePick,
      choose: path => void update($, panel, q => ({ ...q, worktreePick: q.worktreePick === path ? undefined : path })),
      land: w => fill(landPrompt(w, snap?.base || 'main')),
      remove: w => fill(removePrompt(w)),
      open: w => fill(sessionPrompt(w)),
      refresh: () => void loadWorktrees($).catch(() => undefined),
    }
    return (
      <Box flexDirection="column" gap={1}>
        {tabBar(ui, 'worktrees', badges, s, t => void update($, panel, q => ({ ...q, tab: t })), c.isDesktop ? c.W : 0, c.at)}
        {snap ? treesBody(c, snap, s, acts) : <Text dimColor>Reading the worktrees…</Text>}
      </Box>
    )
  }).catch(($, e, next) => paneFailed($, e, next.error, 'worktrees'))
}

// ---------------------------------------------------------------- drawing
export type TreeActs = {
  pick: string | undefined
  choose: (path: string) => void
  land: (w: Worktree) => void
  remove: (w: Worktree) => void
  open: (w: Worktree) => void
  refresh: () => void
}

const changesOf = (w: Worktree) => (w.changes === undefined ? '' : w.changes ? `${w.changes} changed` : 'clean')
const commitOf = (w: Worktree, now: number) => (w.sha ? [w.sha, w.subject ?? '', w.committedAt ? ago(w.committedAt, now) : ''].filter(Boolean).join(' · ') : '')
const flagsOf = (w: Worktree) => [w.isCurrent ? 'this session' : '', w.isLocked ? 'locked' : '', w.isPrunable ? 'folder gone' : ''].filter(Boolean)
const syncTone = (w: Worktree): 'plain' | 'ok' | 'warn' | 'fail' => (!w.upstream ? 'warn' : w.behind ? 'warn' : w.ahead ? 'plain' : 'ok')

// One line a screen reader or the terminal reads for a worktree.
export function treeLine(w: Worktree, now: number): string {
  return [
    w.name, w.branch ?? 'detached', w.issue ?? '', ...flagsOf(w),
    w.error ?? commitOf(w, now), w.error ? '' : changesOf(w), w.error || w.isPrunable ? '' : syncOf(w),
  ].filter(Boolean).join(' · ')
}

const ROW = 46
function listSvg(W: number, items: Worktree[], now: number, theme: Theme, motion: Motion) {
  const H = items.length * ROW + 4
  const rows = items.map((w, i) => {
    const y = i * ROW
    // Right side: changes, then push state, as chips from the right edge in.
    let rx = W - 4, chips = ''
    if (!w.error && !w.isPrunable) {
      const sync = syncOf(w), cw = textWidth(sync, 10.5) + 14
      rx -= cw
      chips += chip(rx, y + 6, sync, syncTone(w))
      const ch = changesOf(w)
      if (ch) {
        const ww = textWidth(ch, 10.5) + 14
        rx -= ww + 6
        chips += chip(rx, y + 6, ch, w.changes ? 'warn' : 'plain')
      }
    }
    const tags = [w.issue ?? '', ...flagsOf(w)].filter(Boolean).join(' · ')
    const nameW = Math.min(textWidth(w.name, 12.5) + 10, (rx - 8) * 0.55)
    const branch = w.branch ?? 'detached HEAD'
    const line2 = w.error ?? commitOf(w, now)
    return `${text(4, y + 18, w.name, { size: 12.5, weight: 600, max: nameW })}`
      + `${text(4 + nameW, y + 18, `${branch}${tags ? `  ${tags}` : ''}`, { size: 11.5, cls: 's', mono: true, max: rx - 12 - nameW })}`
      + chips
      + `${text(4, y + 36, line2, { size: 11.5, cls: w.error ? 'fl' : 'm', max: W - 8 })}`
      + (i < items.length - 1 ? hline(4, W - 4, y + ROW - 1) : '')
  }).join('')
  return { H, svg: wide(W, H, rows, theme, motion) }
}

function headSvg(W: number, snap: WorktreeSnapshot, now: number, theme: Theme, motion: Motion) {
  const repo = snap.root.split('/').pop() || snap.root
  const dirty = snap.items.filter(w => w.changes).length
  const unpushed = snap.items.filter(w => w.branch && !w.upstream && !w.isMain).length
  const sum = [`${snap.items.length} worktree${snap.items.length === 1 ? '' : 's'}`, dirty ? `${dirty} with changes` : '', unpushed ? `${unpushed} not pushed` : ''].filter(Boolean).join(' · ')
  const since = ago(snap.readAt, now)
  const when = !since || since === 'now' ? 'read just now' : `read ${since} ago`
  return wide(W, 44, `${text(0, 14, 'WORKTREES', { size: 10.5, cls: 's' })}${text(W, 14, when, { size: 10.5, cls: 'm', anchor: 'end' })}${text(0, 34, repo, { size: 14, weight: 600, max: W * 0.5 })}${text(W, 34, sum, { size: 11, cls: 's', anchor: 'end', max: W * 0.5 })}`, theme, motion)
}

// The picker: a row of small name buttons, and under it the picked worktree's actions.
function treePicker(c: TabCtx, snap: WorktreeSnapshot, acts: TreeActs) {
  const { Box, Text, Button } = c.ui
  const picked = snap.items.find(w => w.path === acts.pick)
  return (
    <Box key="wt-pick" flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {snap.items.map(w => (
          <Button key={`wt-${w.path}`} label={clip(w.name, 28)} plain={w.path !== acts.pick ? true : undefined} variant={w.path === acts.pick ? 'primary' : undefined} onPress={() => acts.choose(w.path)} />
        ))}
        <Button key="wt-refresh" label="↻ Refresh" plain onPress={acts.refresh} />
      </Box>
      {picked && (
        <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          <Text dimColor>{clip(`${picked.name}${picked.branch ? ` · ${picked.branch}` : ''}`, 48)}</Text>
          {!picked.isMain && picked.branch && <Button key="wt-land" label="Review and land this branch" variant="primary" onPress={() => acts.land(picked)} />}
          {!picked.isMain && !picked.isCurrent && <Button key="wt-remove" label="Remove this worktree" onPress={() => acts.remove(picked)} />}
          {!picked.isPrunable && <Button key="wt-open" label="Open in a session" onPress={() => acts.open(picked)} />}
        </Box>
      )}
    </Box>
  )
}

function treesBody(c: TabCtx, snap: WorktreeSnapshot, s: Settings, acts: TreeActs): RenderElement {
  const { Box, Text } = c.ui
  const Svg = 'Svg' in c.ui ? c.ui.Svg : undefined
  const { theme, motion } = s.look
  if (snap.error || !snap.items.length) {
    return emptyState(c, s.look, 'worktrees', 'No worktrees to show', snap.error ?? 'git worktree list printed nothing for this folder.', 'scout', '#378ADD')
  }
  if (c.isDesktop && Svg) {
    const list = listSvg(c.W, snap.items, c.at, theme, motion)
    return (
      <Box key="worktrees" flexDirection="column" gap={1}>
        <Svg source={headSvg(c.W, snap, c.at, theme, motion)} alt={`Worktrees of ${snap.root}`} height={44} />
        <Svg source={list.svg} alt={snap.items.map(w => treeLine(w, c.at)).join('. ')} height={list.H} />
        {treePicker(c, snap, acts)}
      </Box>
    )
  }
  return (
    <Box key="worktrees" flexDirection="column">
      <Text bold>{`Worktrees  ${snap.items.length}`}</Text>
      {snap.items.map(w => (
        <Box key={`wt-row-${w.path}`} flexDirection="column" marginTop={1}>
          <Text bold>{clip([w.name, w.branch ?? 'detached', w.issue ?? '', ...flagsOf(w)].filter(Boolean).join('  '), Math.max(20, c.cols - 2))}</Text>
          <Text dimColor>{clip(w.error ?? [commitOf(w, c.at), changesOf(w), w.isPrunable ? '' : syncOf(w)].filter(Boolean).join(' · '), Math.max(20, c.cols - 2))}</Text>
        </Box>
      ))}
      <Box marginTop={1}>{treePicker(c, snap, acts)}</Box>
    </Box>
  )
}

async function paneFailed($: EngineInterface, e: PaneInput, error: unknown, where: string): Promise<RenderElement> {
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : JSON.stringify(error)
  await $.store.set('lastError', { where, reason, at: await $.clock.now() }).catch(() => undefined)
  return failedView($.ui.resolve(e), where, reason)
}
