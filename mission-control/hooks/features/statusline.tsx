// Status line: the always-on band above the prompt (replaces Desktop Statusline), the
// daily budget with its alerts, the budget gate on new agents, and /budget.
// Slow work (git, store, rate-limit toasts) runs on a clock; the render only reads.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { AgentRecord, Alert, Budget, PlanWindow, Settings } from '../../types'
import { crab } from '../kit/crabs'
import { box, fline, fsvg, iconInk, meter, svg, text, textWidth } from '../kit/draw'
import { fmtCost, fmtSpan, fmtTime, fmtTokens, modelName } from '../kit/role'
import { DEFAULT_BUDGET, DEFAULT_SETTINGS, STORE, checkBudget, localDay, nameOf, planMode, settingsOf } from '../kit/state'

const agents = atom({ plugin: 'mission-control', key: 'agents' } as const, {} as Record<string, AgentRecord>)
const budget = atom({ plugin: 'mission-control', key: 'budget' } as const, DEFAULT_BUDGET)
const alerts = atom({ plugin: 'mission-control', key: 'alerts' } as const, [] as Alert[])
const settings = atom({ plugin: 'mission-control', key: 'settings' } as const, DEFAULT_SETTINGS)
// Bumped when what the band shows changes, so the band (and only the band) redraws.
const band = atom({ plugin: 'mission-control', key: 'band' } as const, 0)

const CACHE_MS = 5 * 60 * 1000
const GIT_EVERY_MS = 15_000
const NARROW = 110

// ---------------------------------------------------------------- pure helpers
export type Git = {
  branch: string; changed: number; ahead: number; behind: number; isWorktree?: boolean
  staged?: number; modified?: number; untracked?: number; conflicts?: number
  stashes?: number; last?: { sha: string; subject: string; age: string }
}

// `git status --porcelain=v2 --branch`
export function parseGit(out: string): Git | null {
  let branch = ''
  let ahead = 0
  let behind = 0
  let changed = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice(14).trim()
    else if (line.startsWith('# branch.ab ')) {
      ahead = Number(/\+(\d+)/.exec(line)?.[1] ?? 0)
      behind = Number(/-(\d+)/.exec(line)?.[1] ?? 0)
    }
    else if (line.trim() && !line.startsWith('#')) changed++
  }
  if (!branch) return null
  // Porcelain v2: "1 XY", "2 XY" (renamed), "u" (unmerged), "?" (untracked); X is the index, Y the tree.
  let staged = 0, modified = 0, untracked = 0, conflicts = 0
  for (const line of out.split('\n')) {
    if (line.startsWith('? ')) untracked++
    else if (line.startsWith('u ')) conflicts++
    else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.slice(2, 4)
      if (xy[0] !== '.') staged++
      if (xy[1] !== '.') modified++
    }
  }
  return { branch: branch === '(detached)' ? 'detached' : branch, changed, ahead, behind, staged, modified, untracked, conflicts }
}

// cache read / (input + cache read + cache creation), as a whole percent.
export function cacheHit(u: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): number {
  const total = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
  return total > 0 ? Math.round(((u.cache_read_input_tokens || 0) / total) * 100) : 0
}

// "1h 18m", "3d 4h", "42s".
export function fmtReset(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return m > 0 ? `${m}m` : `${Math.max(0, Math.round(ms / 1000))}s`
}

export function budgetState(spent: number, limit: number, warnAt: number): 'ok' | 'warn' | 'fail' {
  if (!(limit > 0)) return 'ok'
  const r = spent / limit
  return r >= 1 ? 'fail' : r >= warnAt ? 'warn' : 'ok'
}

const usd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)
const base = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
const toneOf = (r: number) => (r >= 0.95 ? 'fail' : r >= 0.8 ? 'warn' : 'ink') as 'fail' | 'warn' | 'ink'

// ---------------------------------------------------------------- in-memory cache
// Regenerable figures only; nothing here has to survive a reload.
const snap: { git: Git | null; repo: string; dir: string; gitAt: number } = { git: null, repo: '', dir: '', gitAt: -Infinity }
const last: { model: string; durMs: number; hit: number; endedAt: number } = { model: '', durMs: 0, hit: 0, endedAt: 0 }
const state = { compactions: 0, before: 0, after: 0, credit: 0, creditFor: '', running: false }
const hidden = new Set<string>()
const toasted = new Set<string>()

// ---------------------------------------------------------------- slow work
async function refreshGit($: EngineInterface, now: number) {
  if (now - snap.gitAt < GIT_EVERY_MS) return
  snap.gitAt = now
  const cwd = await $.session.cwd()
  const repo = await $.session.repo().catch(() => null)
  snap.repo = repo?.name || base(cwd)
  const r = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { cwd, timeoutMs: 4000 }).catch(() => null)
  snap.git = r && r.exitCode === 0 ? parseGit(r.stdout) : null
  if (snap.git) {
    // A worktree's git dir differs from the common one.
    const d = await $.process.run(['git', 'rev-parse', '--git-dir', '--git-common-dir'], { cwd, timeoutMs: 4000 }).catch(() => null)
    const [gitDir, common] = d && d.exitCode === 0 ? d.stdout.trim().split('\n') : []
    snap.git.isWorktree = !!gitDir && !!common && gitDir !== common
    const st = await $.process.run(['git', 'stash', 'list'], { cwd, timeoutMs: 4000 }).catch(() => null)
    snap.git.stashes = st && st.exitCode === 0 ? st.stdout.split('\n').filter(Boolean).length : 0
    const lg = await $.process.run(['git', 'log', '-1', '--format=%h%x09%s%x09%cr'], { cwd, timeoutMs: 4000 }).catch(() => null)
    const [sha, subject, age] = lg && lg.exitCode === 0 ? lg.stdout.trim().split('\t') : []
    if (sha) snap.git.last = { sha, subject: subject ?? '', age: (age ?? '').replace(/ ago$/, '') }
  }
  snap.dir = cwd
}

async function tickBudget($: EngineInterface) {
  if (state.running) return
  state.running = true
  try {
    const now = await $.clock.now()
    const day = localDay(now)
    const usage = await $.session.usage()
    const s = settingsOf(await read($, settings))
    // The session's cost already sums every priced response, sub-agents included
    // (it is what /cost totals), so agents' costUsd is never added on top.
    const session = usage.cost?.usd ?? 0

    // Add only this session's delta to today's total, so it survives sessions and reloads.
    const sid = String(await $.session.id())
    if (state.creditFor !== sid) {
      state.creditFor = sid
      state.credit = Number(await $.store.get(`credit:${sid}`)) || 0
    }
    let today = Number(await $.store.get(STORE.spend(day))) || 0
    const delta = session - state.credit
    if (delta > 1e-7) {
      today += delta
      await $.store.set(STORE.spend(day), today)
    }
    if (Math.abs(delta) > 1e-7) {
      state.credit = session
      await $.store.set(`credit:${sid}`, session)
    }
    // The plan's windows, when the account has them (a subscription).
    const win = (kind: string): PlanWindow | undefined => {
      const r = usage.rateLimits.find(x => x.kind === kind)
      return r ? { pct: r.percentUsed, resetsAt: r.resetsAt } : undefined
    }
    const next: Budget = { day, spentToday: today, sessionSpent: session, fiveHour: win('five_hour'), week: win('seven_day') }
    await update($, budget, () => next)

    // Budget alert: plan windows or daily dollars, whichever applies.
    const chk = checkBudget(s, next, now)
    const st = chk.state
    const paused = st === 'fail' && s.budget.pauseWhenReached
    const alert: Alert | null = st === 'ok' || hidden.has(`budget:${st}`) ? null : {
      id: 'budget', kind: 'budget', tone: st, at: now, ratio: Math.min(1, chk.ratio),
      label: paused ? `${chk.label} · new agents paused` : chk.label,
      detail: chk.detail,
    }
    await update($, alerts, list0 => {
      const rest = list0.filter(a => a.id !== 'budget')
      if (!alert) return rest.length === list0.length ? list0 : rest
      const old = list0.find(a => a.id === 'budget')
      return [...rest, old && old.tone === alert.tone ? { ...alert, at: old.at } : alert]
    })

    // Rate limits: one toast per threshold per window.
    for (const rl of usage.rateLimits) {
      const name = rl.kind === 'five_hour' ? '5-hour' : rl.kind === 'seven_day' ? 'Weekly' : ''
      if (!name) continue
      for (const th of [95, 80]) {
        const key = `${rl.kind}:${th}:${rl.resetsAt ?? ''}`
        if (rl.percentUsed < th) continue
        if (!toasted.has(key)) {
          toasted.add(key)
          toasted.add(`${rl.kind}:80:${rl.resetsAt ?? ''}`)
          const left = rl.resetsAt ? ` Resets in ${fmtReset(Date.parse(rl.resetsAt) - now)}.` : ''
          $.ui.toast(`${name} limit at ${Math.round(rl.percentUsed)}%.${left}`)
        }
        break
      }
    }
  } finally {
    state.running = false
  }
}

// Every 5 s: git and the budget, then a redraw of the band only if something it shows changed.
// (ui.invalidate would redraw every drawing of the plugin, the whole panel included.)
const shown = { sig: '' }
async function tick($: EngineInterface) {
  const now = await $.clock.now()
  await refreshGit($, now).catch(() => undefined)
  await tickBudget($).catch(() => undefined)
  const usage = await $.session.usage().catch(() => null)
  const turns = await $.session.turns().catch(() => 0)
  const sig = JSON.stringify([
    snap.git, snap.dir, snap.repo, turns, last, state.compactions, state.before, state.after,
    Math.floor(now / 60_000),
    usage && [Math.round((usage.cost?.usd ?? 0) * 100), Math.round(usage.context.percent ?? 0), fmtTokens(usage.context.tokens ?? 0), usage.startedAt,
      usage.rateLimits.map(r => [r.kind, Math.round(r.percentUsed), r.resetsAt])],
  ])
  if (sig === shown.sig) return
  shown.sig = sig
  await update($, band, n => (n + 1) % 1_000_000)
}

async function hide($: EngineInterface, a: Alert) {
  if (a.id === 'budget') hidden.add(`budget:${a.tone}`)
  await update($, alerts, list => list.filter(x => x.id !== a.id))
}

// ---------------------------------------------------------------- drawing
type Item = { w: number; draw: (x: number, y: number) => string }
type Seg = { s: string; cls?: string; weight?: number }
const GAP = 18
const SIZE = 12

// Text segments one after another, optionally led by an icon.
function seg(parts: Seg[], icon?: string): Item {
  const lead = icon ? 19 : 0
  const ws = parts.map(p => textWidth(p.s, SIZE) * (p.weight ? 1.05 : 1) + 4)
  return {
    w: lead + ws.reduce((a, b) => a + b, 0) - 4,
    draw: (x, y) => {
      let cx = x + lead
      return (icon ? iconInk(icon, x, y - 11.5, 14, 'muted') : '') + parts.map((p, i) => {
        const out = text(cx, y, p.s, { size: SIZE, cls: p.cls ?? 't', weight: p.weight })
        cx += ws[i] ?? 0
        return out
      }).join('')
    },
  }
}

function meterItem(name: string, ratio: number, barW: number, extra?: string): Item {
  const pct = `${Math.round(ratio * 100)}%`
  const lw = textWidth(name, 11.5) + 6
  const pw = textWidth(pct, SIZE) * 1.05 + 6
  const ew = extra ? textWidth(extra, 11.5) + 4 : 0
  return {
    w: lw + barW + 6 + pw + ew,
    draw: (x, y) => text(x, y, name, { size: 11.5, cls: 's' }) + meter(x + lw, y - 7, barW, ratio, toneOf(ratio))
      + text(x + lw + barW + 6, y, pct, { size: SIZE, weight: 600 }) + (extra ? text(x + lw + barW + 6 + pw, y, extra, { size: 11.5, cls: 's' }) : ''),
  }
}

function crabsItem(live: AgentRecord[], scale: number): Item | null {
  if (!live.length) return null
  const shown = live.slice(0, 5)
  const step = 30 * scale + 3
  const more = live.length - shown.length
  const word = `${live.length} live`
  const cw = shown.length * step
  return {
    w: cw + 4 + textWidth(word, 11.5) + (more ? textWidth(`+${more}`, 11.5) + 4 : 0),
    draw: (x, y) => shown.map((a, i) => crab(x + i * step, y - 12.5, a.role, a.color, true, scale)).join('')
      + (more ? text(x + cw, y, `+${more}`, { size: 11.5, cls: 's' }) : '')
      + text(x + cw + (more ? textWidth(`+${more}`, 11.5) + 4 : 0) + 4, y, word, { size: 11.5, cls: 's' }),
  }
}

function lay(items: (Item | null)[], x0: number, y: number, maxX: number): string {
  let x = x0
  let out = ''
  for (const it of items) {
    if (!it) continue
    if (x + it.w > maxX) break
    out += it.draw(x, y)
    x += it.w + GAP
  }
  return out
}

function alertSvg(W: number, a: Alert, theme: 'follow' | 'light' | 'dark', motion: 'full' | 'calm' | 'off') {
  const cls = a.tone === 'fail' ? 'fl' : a.tone === 'warn' ? 'wn' : 'ok'
  const lw = textWidth(a.label, SIZE) * 1.05
  const hasBar = a.ratio !== undefined
  const barX = 30 + lw + 12
  const barW = hasBar ? 90 : 0
  const detailX = barX + (hasBar ? barW + 12 : 0)
  return svg(W, 30, `${box(0, 0, W, 30)}<circle class="${cls}" cx="18" cy="15" r="4"/>${text(30, 19, a.label, { size: SIZE, weight: 600 })}`
    + (hasBar ? meter(barX, 13, barW, Math.min(1, a.ratio ?? 0), a.tone === 'fail' ? 'fail' : a.tone === 'warn' ? 'warn' : 'ink') : '')
    + (a.detail ? text(detailX, 19, a.detail, { size: 11.5, cls: 's', max: Math.max(40, W - detailX - 12) }) : ''), theme, motion)
}

// ---------------------------------------------------------------- hooks
export function registerStatusLine(on: On): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'budget', description: 'When new agents pause: a share of the plan’s 5-hour or weekly window, or a daily dollar limit', argumentHint: '[5h <percent> | week <percent> | plan | <dollars>]' }).catch(() => undefined)
    void tick($).catch(() => undefined)
    $.clock.every(5000, () => void tick($).catch(() => undefined))
    return started
  })

  on('turn.complete', { reason: ['answer', 'aborted', 'refusal', 'error'] }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.usage) {
      last.model = e.usage.model
      last.durMs = e.durationMs
      last.hit = cacheHit(e.usage)
      last.endedAt = await $.clock.now()
    }
    void tick($).catch(() => undefined)
    return result
  })

  on('session.compact', { trigger: ['manual', 'auto', 'plugin', 'precompute'] }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && !('skip' in result && result.skip)) {
      state.compactions++
      const r = result as { tokensBefore?: number; tokensAfter?: number }
      state.before = r.tokensBefore ?? 0
      state.after = r.tokensAfter ?? 0
      void tick($).catch(() => undefined)
    }
    return result
  })

  on('agent.spawn', { fork: [true, false] }, async ($, e, next) => {
    const s = settingsOf(await read($, settings))
    if (s.budget.pauseWhenReached) {
      const chk = checkBudget(s, await read($, budget), await $.clock.now())
      if (chk.state === 'fail') return { deny: chk.deny }
    }
    return next(e)
  })

  // /budget            shows what applies now
  // /budget 5h 95      pause new agents at 95% of the 5-hour window (plan)
  // /budget week 90    pause at 90% of the weekly window (plan)
  // /budget plan       follow the plan's windows;  /budget 8  a daily limit of $8
  on('command.run', { command: 'budget' }, async ($, e) => {
    const args = String(e.args ?? '').trim().toLowerCase()
    const cur = settingsOf(await read($, settings))
    const set = async (budget: Settings['budget'], text: string) => {
      const updated = { ...cur, budget }
      await update($, settings, () => updated)
      await $.store.set(STORE.settings, updated)
      hidden.clear()
      await tickBudget($).catch(() => undefined)
      return { text }
    }
    const win = /^(5h|five|week|weekly|7d)\s+(\d{1,3})%?$/.exec(args)
    if (win) {
      const pct = Math.min(100, Math.max(1, Number(win[2])))
      const isWeek = (win[1] ?? '').startsWith('w') || win[1] === '7d'
      return set({ ...cur.budget, mode: 'plan', ...(isWeek ? { weekPauseAt: pct } : { fiveHourPauseAt: pct }) },
        `New agents now pause at ${pct}% of the ${isWeek ? 'weekly' : '5-hour'} window.`)
    }
    if (args === 'plan') return set({ ...cur.budget, mode: 'plan' }, `Budget follows your plan: pause at ${cur.budget.fiveHourPauseAt}% of the 5-hour window and ${cur.budget.weekPauseAt}% of the week.`)
    if (args === 'auto') return set({ ...cur.budget, mode: 'auto' }, 'Budget follows your plan when it has windows, and the daily dollars otherwise.')
    const n = Number(/^\$?\s*(\d+(?:\.\d+)?)$/.exec(args)?.[1])
    if (n > 0) return set({ ...cur.budget, mode: 'dollars', dailyUsd: n }, `Daily budget set to ${usd(n)}. Today so far: ${fmtCost((await read($, budget)).spentToday)}.`)
    const b = await read($, budget)
    const now = await $.clock.now()
    const chk = checkBudget(cur, b, now)
    const how = planMode(cur, b)
      ? `Budget follows your plan: new agents pause at ${cur.budget.fiveHourPauseAt}% of the 5-hour window (now ${Math.round(b.fiveHour?.pct ?? 0)}%) and ${cur.budget.weekPauseAt}% of the week (now ${Math.round(b.week?.pct ?? 0)}%).`
      : `Daily budget is ${usd(cur.budget.dailyUsd)}; today so far ${fmtCost(b.spentToday)}.`
    return { text: `${how}${chk.state === 'fail' ? ' Limit reached.' : ''} Change it with /budget 5h <percent>, /budget week <percent>, /budget plan or /budget <dollars>.` }
  })

  // The band above the prompt: text rows and small meters (the host lays text out itself,
  // so nothing is dropped at any width). Three layouts, three git styles; every part follows
  // its switch in Settings › Status line. Bars colour by use: green, amber from 60%, red from 85%.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, band)
    const s = settingsOf(await read($, settings))
    if (e.props.hasSurvey || !s.show.statusLine) return next(e)
    const ui = $.ui.resolve(e)
    if (e.surface !== 'desktop' || !('Svg' in ui)) return next(e)
    const { Box, Button, Svg, Text } = ui
    const p = s.statusLine
    const theme = s.look.theme

    const now = await $.clock.now()
    const usage = await $.session.usage()
    const turns = await $.session.turns()
    const all = Object.values(await read($, agents))
    const live = all.filter(a => !a.isMain && (a.status === 'starting' || a.status === 'thinking' || a.status === 'writing' || a.status === 'tool'))
    const b = await read($, budget)
    const list = await read($, alerts)
    const alert = list.reduce<Alert | undefined>((n, a) => (!n || a.at >= n.at ? a : n), undefined)
    const ttl = p.cacheTtl === '5m' ? 5 * 60_000 : 60 * 60_000

    const session = usage.cost?.usd ?? 0
    const today = b.day ? b.spentToday : session
    const git = snap.git
    const dir = snap.dir ? base(snap.dir) : snap.repo || base(await $.session.cwd())
    const ctx = usage.context
    const ctxPct = ctx.percent ?? (ctx.tokens !== undefined && ctx.window ? (ctx.tokens / ctx.window) * 100 : undefined)
    const limits = usage.rateLimits.filter(r => r.kind === 'five_hour' || r.kind === 'seven_day')
    const until = (iso?: string) => (iso ? fmtReset(Date.parse(iso) - now) : '')
    const level = (pct: number) => (pct >= 85 ? 'hi' : pct >= 60 ? 'mid' : 'lo')
    const color = (pct: number) => ({ hi: 'error', mid: 'warning', lo: 'success' } as const)[level(pct)]
    const bar = (pct: number, w: number) => svg(w, 8, meter(0, 2, w, pct / 100, ({ hi: 'fail', mid: 'warn', lo: 'ok' } as const)[level(pct)]), theme, 'off')
    const isCompact = p.layout === 'compact', isSemi = p.layout === 'semi'

    // A small rounded chip with coloured parts, drawn as one image (the host has no text ground).
    const chipSvg = (key: string, parts: { s: string; cls?: string }[], icon?: string) => {
      const w = parts.reduce((n, x) => n + textWidth(x.s, 11.5) + 6, icon ? 30 : 14)
      let x = icon ? 24 : 7
      const body = box(0, 0, w, 18, 'tile', 5) + (icon ? iconInk(icon, 6, 2.5, 13) : '')
        + parts.map(part => { const t = text(x, 13, part.s, { size: 11.5, weight: 600, cls: part.cls ?? 't' }); x += textWidth(part.s, 11.5) + 6; return t }).join('')
      return <Svg key={key} source={svg(Math.ceil(w), 18, body, theme, 'off')} alt={parts.map(x => x.s).join(' ')} width={Math.ceil(w)} height={18} />
    }
    const agentIcon = (key: string) => <Svg key={key} source={svg(14, 14, iconInk('spawn', 0, 0, 14), theme, 'off')} alt="Running agents" width={14} height={14} />

    // Where: folder, then git in the chosen style.
    const gitParts = (): RenderElement[] => {
      if (!git) return []
      const changed = git.changed ? [`~${git.changed} changed`] : []
      if (p.git === 'quiet' || isCompact) {
        return [
          <Text key="g-q" wrap="truncate-end">{`🌿 ${git.branch}${git.isWorktree ? ' 🌳' : ''}${git.ahead ? ` ↑${git.ahead}` : ''}${git.behind ? ` ↓${git.behind}` : ''}`}</Text>,
          ...(changed.length ? [<Text key="g-qc" color="warning">{changed[0]}</Text>] : []),
        ]
      }
      const out: RenderElement[] = [chipSvg('g-br', [{ s: git.branch }], 'branch')]
      if (git.isWorktree) out.push(chipSvg('g-wt', [{ s: 'worktree', cls: 's' }]))
      if (git.ahead || git.behind) out.push(chipSvg('g-ab', [...(git.ahead ? [{ s: `↑${git.ahead}`, cls: 'ok' }] : []), ...(git.behind ? [{ s: `↓${git.behind}`, cls: 'wn' }] : [])]))
      if (isSemi) {
        if (git.changed) out.push(chipSvg('g-ch', [{ s: `~${git.changed} changed`, cls: 'wn' }]))
        return out
      }
      if (p.git === 'chips') {
        if (git.staged) out.push(chipSvg('g-st', [{ s: `+${git.staged} staged`, cls: 'ok' }]))
        if (git.modified) out.push(chipSvg('g-md', [{ s: `~${git.modified} modified`, cls: 'wn' }]))
        if (git.untracked) out.push(chipSvg('g-un', [{ s: `?${git.untracked} untracked`, cls: 's' }]))
      }
      return out
    }
    // Full git style: a second line with the parts of the change, conflicts, stashes, last commit.
    const gitLine = git && p.git === 'full' && !isCompact && !isSemi ? (
      <Box key="gitline" flexDirection="row" justifyContent="space-between" width="100%">
        <Box flexDirection="row" gap={2} flexWrap="wrap">
          {git.staged ? <Text color="success">{`+${git.staged} staged`}</Text> : null}
          {git.modified ? <Text color="warning">{`~${git.modified} modified`}</Text> : null}
          {git.untracked ? <Text dimColor>{`?${git.untracked} untracked`}</Text> : null}
          {git.conflicts ? <Text color="error">{`✗ ${git.conflicts} conflict${git.conflicts > 1 ? 's' : ''}`}</Text> : null}
          {git.stashes ? <Text dimColor>{`${git.stashes} stash${git.stashes > 1 ? 'es' : ''}`}</Text> : null}
          {!git.changed && !git.stashes ? <Text dimColor>clean</Text> : null}
        </Box>
        {git.last ? <Box marginLeft={2} flexShrink={1}><Text dimColor wrap="truncate-end">{`last commit ${git.last.sha} “${git.last.subject}” · ${git.last.age} ago`}</Text></Box> : null}
      </Box>
    ) : null

    const sessionText = isSemi
      ? `${usage.startedAt ? fmtSpan(now - usage.startedAt) : '<1m'} · ${turns} prompt${turns === 1 ? '' : 's'} · $${session.toFixed(2)}`
      : [
        `session ${usage.startedAt ? fmtSpan(now - usage.startedAt) : '<1m'}`,
        `${turns} prompt${turns === 1 ? '' : 's'}`,
        `$${session.toFixed(2)}`,
        ...(p.today && b.day ? [`$${today.toFixed(2)} today`] : []),
      ].join(' · ')

    // A meter: name, bar, percent in the bar's colour, and a muted detail.
    const meterRow = (key: string, name: string, pct: number | undefined, detail: string, w: number, nameCells = 8) => (
      <Box key={key} flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
        <Box width={nameCells} flexShrink={0}><Text dimColor={isSemi || isCompact}>{name}</Text></Box>
        {pct === undefined
          ? <Text dimColor>waiting for the first reply</Text>
          : <Svg source={bar(pct, w)} alt={`${name} ${Math.round(pct)}% used`} width={w} height={8} />}
        {pct !== undefined && <Text bold color={color(pct)}>{`${Math.round(pct)}%`}</Text>}
        {detail ? <Text dimColor>{detail}</Text> : null}
      </Box>
    )

    const activity: { text: string; warn?: boolean }[] = []
    if (p.lastTurn && last.model) {
      activity.push({ text: `Last turn ${fmtTime(last.durMs)} on ${modelName(last.model)}` })
      activity.push({ text: `cache ${last.hit}%`, warn: last.hit < 50 })
    }
    if (p.idle && last.endedAt && !e.props.isWorking) {
      const idle = now - last.endedAt
      activity.push({ text: `idle ${fmtSpan(idle)}${idle >= ttl ? ' (cache cold)' : ''}`, warn: idle >= ttl })
    }
    if (p.compactions && state.compactions) {
      activity.push({ text: `compacted ${state.compactions}×${state.before && state.after ? ` (last ${fmtTokens(state.before)} → ${fmtTokens(state.after)})` : ''}` })
    }

    // Fixed bar widths: bodyColumns does not follow the band's real width, and bars sized
    // from it pushed meters onto lines of their own.
    const ctxBar = 180, limBar = 90
    const shownAgents = live.slice(0, 3)
    const alertRow = alert ? (
      <Box key="alert" flexDirection="row" alignItems="center" gap={1}>
        <Text color={alert.tone === 'fail' ? 'error' : alert.tone === 'warn' ? 'warning' : undefined} bold>{`● ${alert.label}`}</Text>
        <Text dimColor wrap="truncate-end">{alert.detail}</Text>
        <Button key="hide-alert" plain label="Hide" onPress={() => void hide($, alert)} />
      </Box>
    ) : null
    const agentCount = p.agents && live.length > 0 ? (
      <Box key="agent-count" flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
        {agentIcon('ag-ic')}
        <Text dimColor>{isCompact ? `${live.length}` : `${live.length} agent${live.length > 1 ? 's' : ''}`}</Text>
      </Box>
    ) : null
    const where = p.where ? (
      <Box key="where" flexDirection="row" alignItems="center" gap={1} flexShrink={1} flexWrap="wrap">
        <Text bold wrap="truncate-end">{`📁 ${dir}`}</Text>
        {gitParts()}
      </Box>
    ) : <Box key="where" />

    // Compact: one line; the cost and running agents sit on the right.
    if (isCompact) {
      const mini = (key: string, name: string, pct: number) => (
        <Box key={key} flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
          <Text dimColor>{name}</Text>
          <Svg source={bar(pct, 44)} alt={`${name} ${Math.round(pct)}%`} width={44} height={8} />
          <Text bold color={color(pct)}>{`${Math.round(pct)}%`}</Text>
        </Box>
      )
      return (
        <Box flexDirection="column">
          {/* The meters move as one group: on a narrow band they drop to a second line together,
              and the cost and agents stay on the first line, at the right. */}
          <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start" width="100%" gap={2}>
            <Box flexDirection="row" alignItems="center" flexWrap="wrap" columnGap={3} flexShrink={1}>
              {where}
              <Box key="meters" flexDirection="row" alignItems="center" gap={2} flexShrink={0}>
                {p.context && ctxPct !== undefined && mini('ctx', 'Ctx', ctxPct)}
                {p.limits && limits.map(r => mini(r.kind, r.kind === 'five_hour' ? '5h' : 'Wk', r.percentUsed))}
              </Box>
            </Box>
            <Box flexDirection="row" alignItems="center" gap={2} flexShrink={0}>
              {p.session && <Text bold>{`$${session.toFixed(2)}`}</Text>}
              {agentCount}
            </Box>
          </Box>
          {alertRow}
        </Box>
      )
    }

    // First line, every layout but compact: where on the left, the session always on the right.
    const head = (p.where || p.session) && (
      <Box key="head" flexDirection="row" justifyContent="space-between" alignItems="flex-start" width="100%" gap={2}>
        {where}
        <Box flexDirection="row" alignItems="center" gap={2} flexShrink={0}>
          {p.session && <Text dimColor>{sessionText}</Text>}
          {isSemi && agentCount}
        </Box>
      </Box>
    )

    // Semi-compact: two lines, meters with short resets and the agent count on the right.
    if (isSemi) {
      return (
        <Box flexDirection="column">
          {head}
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" width="100%" gap={2}>
            <Box flexDirection="row" alignItems="center" flexWrap="wrap" columnGap={3} flexShrink={1}>
              {p.context && meterRow('ctx', 'Context', ctxPct, '', 70, 7)}
              {p.limits && limits.map(r => meterRow(r.kind, r.kind === 'five_hour' ? '5-hour' : 'Weekly', r.percentUsed, r.resetsAt ? `↻ ${until(r.resetsAt)}` : '', 50, 6))}
            </Box>
          </Box>
          {alertRow}
        </Box>
      )
    }

    // Detailed.
    return (
      <Box flexDirection="column">
        {head}
        {gitLine}
        {p.context && meterRow('ctx', 'Context', ctxPct, ctx.tokens !== undefined ? `${fmtTokens(ctx.tokens)} / ${fmtTokens(ctx.window)}` : '', ctxBar)}
        {p.limits && limits.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={4}>
            {limits.map(r => meterRow(r.kind, r.kind === 'five_hour' ? '5-hour' : 'Weekly', r.percentUsed, r.resetsAt ? `resets in ${until(r.resetsAt)}` : '', limBar))}
          </Box>
        )}
        {activity.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap">
            {activity.map((a, i) => (
              <Box key={`act-${i}`} flexDirection="row">
                {i > 0 && <Text dimColor>{' · '}</Text>}
                <Text color={a.warn ? 'warning' : undefined} dimColor={!a.warn}>{a.text}</Text>
              </Box>
            ))}
          </Box>
        )}
        {p.agents && shownAgents.length > 0 && (
          // Running agents in a box of their own, a line between each.
          <Box key="agents" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            {shownAgents.map((a, i) => (
              <Box key={`ag-${a.id}`} flexDirection="column">
                {i > 0 && <Svg source={fsvg(1, fline(0), theme, 'off')} alt="" height={1} />}
                <Box flexDirection="row" justifyContent="space-between" width="100%">
                  <Box flexDirection="row" gap={1} flexShrink={1}>
                    <Text>⏳</Text>
                    <Text bold>{nameOf(a, s)}</Text>
                    <Text wrap="truncate-end">{`· ${a.now.text}`}</Text>
                  </Box>
                  <Box marginLeft={2} flexShrink={0}><Text dimColor>{`${a.role} · ${fmtSpan(now - a.startedAt)}`}</Text></Box>
                </Box>
              </Box>
            ))}
            {live.length > shownAgents.length && <Text dimColor>{`+${live.length - shownAgents.length} more running`}</Text>}
          </Box>
        )}
        {alertRow}
      </Box>
    )
  })
}
