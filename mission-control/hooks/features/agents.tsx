// Agents: tracks every sub-agent (spawn, steps, tools, completion), applies the
// per-agent model and effort overrides, and draws the Agents tab and the
// collapsed panel.
import { atom, read, update } from 'claude-code'
import { failedView } from '../kit/ui'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { AgentOverride, AgentRecord, BoardSnapshot, Delegation } from '../../types'
import { FEATURE_TABS, activeTab, badgesFrom, clip, tabBar } from '../kit/chrome'
import {
  fsvg, fprogress, right, FONT,
  avatar, barText, bubble, chip, estText, hline, iconInk, label, outline, progress, spark, statusWord, svg, text, textWidth, box, meter, wrap, fitText, wide,
} from '../kit/draw'
import type { ProgKind } from '../kit/draw'
import { costOf, describeTool, estimateOf, expectedStepsOf, fmtAgo, fmtCost, fmtSpan, fmtTime, fmtTokens, modelName, roleOf, callsignOf, windowOf } from '../kit/role'
import { DEFAULT_BUDGET, DEFAULT_PANEL, DEFAULT_SETTINGS, PANE, TITLE, makeCtx, nameOf, planMode, settingsOf } from '../kit/state'
import type { PaneInput } from '../kit/state'
import type { TabCtx } from '../kit/state'
import { divider, emptyState, section } from '../kit/ui'

const agents = atom({ plugin: 'mission-control', key: 'agents' } as const, {} as Record<string, AgentRecord>)
const board = atom({ plugin: 'mission-control', key: 'board' } as const, null as BoardSnapshot | null)
const budget = atom({ plugin: 'mission-control', key: 'budget' } as const, DEFAULT_BUDGET)
const delegations = atom({ plugin: 'mission-control', key: 'delegations' } as const, {} as Record<string, Delegation>)
const order = atom({ plugin: 'mission-control', key: 'order' } as const, [] as string[])
const overrides = atom({ plugin: 'mission-control', key: 'overrides' } as const, {} as Record<string, AgentOverride>)
const panel = atom({ plugin: 'mission-control', key: 'panel' } as const, DEFAULT_PANEL)
const settings = atom({ plugin: 'mission-control', key: 'settings' } as const, DEFAULT_SETTINGS)
const tick = atom({ plugin: 'mission-control', key: 'tick' } as const, 0)

const MAX_KEPT = 40
const OWN_STEP = 'mcp__mission-control__step'
const STEP_TOOLS = ['mcp__savvy-progress__step', OWN_STEP]
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']

export const isLive = (a: AgentRecord) => a.status !== 'done' && a.status !== 'failed' && a.status !== 'stopped' && a.status !== 'idle'
export const MAIN_ID = 'main'
const tokensOf = (a: AgentRecord) => a.inputTokens + a.outputTokens + a.cacheRead + a.cacheWrite
const ctxPct = (a: AgentRecord) => Math.min(100, Math.round((a.contextTokens / windowOf(a.model)) * 100))
const elapsed = (a: AgentRecord, at: number) => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt
const modelOf = (a: AgentRecord) => (a.effort ? `${modelName(a.model)} · ${a.effort}` : modelName(a.model))
const WORD: Record<AgentRecord['status'], string> = { starting: 'Starting', thinking: 'Thinking', writing: 'Writing report', tool: 'Working', idle: 'Waiting for you', done: 'Done', failed: 'Needs you', stopped: 'Stopped' }

function prog(a: AgentRecord): { ratio: number; kind: ProgKind; count: string } {
  if (a.status === 'idle') return { ratio: 1, kind: 'done', count: 'ready' }
  if (a.status === 'done') return { ratio: 1, kind: 'done', count: a.stepTotal ? `${a.stepTotal}/${a.stepTotal}` : 'done' }
  const est = estimateOf(a.steps, expectedStepsOf(a.role), false)
  if (a.status === 'failed' || a.status === 'stopped') {
    const r = a.stepTotal ? (a.stepDone ?? 0) / a.stepTotal : est
    return { ratio: r, kind: 'halted', count: a.stepTotal ? `stopped at ${a.stepDone ?? 0}/${a.stepTotal}` : 'stopped' }
  }
  if (a.stepTotal) return { ratio: Math.min(1, (a.stepDone ?? 0) / a.stepTotal), kind: 'real', count: `${a.stepDone ?? 0}/${a.stepTotal}` }
  return { ratio: est, kind: 'est', count: 'estimate' }
}
const bubbleOf = (a: AgentRecord) => (a.status === 'failed' ? 'alert' : a.status === 'done' || a.status === 'idle' ? 'check' : a.status === 'stopped' ? 'stop' : a.status === 'thinking' ? 'think' : a.status === 'writing' ? 'pen' : a.status === 'starting' ? 'boot' : 'gear') as Parameters<typeof bubble>[2]

async function patch($: EngineInterface, id: string, fn: (a: AgentRecord) => AgentRecord) {
  await update($, agents, all => (all[id] ? { ...all, [id]: fn(all[id]) } : all))
}
const logged = (a: AgentRecord, at: number, icon: string, t: string): AgentRecord => ({ ...a, log: [...a.log, { at, icon, text: t }].slice(-12) })

// The session's own agent, shown first in the list like any sub-agent.
export function mainRecord(now: number, model: string): AgentRecord {
  return {
    id: MAIN_ID, isMain: true, role: 'Lead', emoji: '🦀', color: '#D97757', callsign: 'Claude · Main',
    description: 'This session', mission: 'Waiting for your first prompt', subagentType: 'main', model, background: false,
    startedAt: now, status: 'idle', now: { icon: '✅', text: 'Waiting for your prompt' },
    steps: 0, tools: 0, files: [], inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, contextTokens: 0, costUsd: 0,
    log: [{ at: now, icon: '🚀', text: 'Session started' }],
  }
}
// Keeps the newest records and never drops the main agent.
const kept = (list: string[]) => {
  const tail = list.slice(-MAX_KEPT)
  return list.includes(MAIN_ID) && !tail.includes(MAIN_ID) ? [MAIN_ID, ...tail.slice(1)] : tail
}

// Output tokens a minute across live agents, sampled each clock tick for the sparkline.
const rateHistory: number[] = []
let lastSample = 0
function sampleRate(list: AgentRecord[], at: number) {
  if (at - lastSample < 4000) return
  lastSample = at
  const rate = list.filter(isLive).reduce((n, a) => n + a.outputTokens / Math.max(1 / 6, elapsed(a, at) / 60000), 0)
  rateHistory.push(rate)
  if (rateHistory.length > 30) rateHistory.shift()
}

// ---------------------------------------------------------------- tracking
export function registerAgents(on: On): void {
  on('agent.spawn', { fork: [true, false] }, async ($, e, next) => {
    // Settings › Agents and models: a role's default model, unless the call chose one.
    const routing = settingsOf(await read($, settings)).routing
    const want = routing.byRole[roleOf(e.subagentType, e.description, e.prompt).role.toLowerCase()]?.model
    const started = await next(want && !e.model && !e.fork ? { ...e, model: want } : e)
    if (!started.agentId) return started
    const id = started.agentId
    const now = await $.clock.now()
    const role = roleOf(e.subagentType, e.description, e.prompt)
    const all = await read($, agents)
    const nth = Object.values(all).filter(a => a.role === role.role).length
    const record: AgentRecord = {
      id, role: role.role, emoji: role.emoji, color: role.color,
      callsign: e.name ? `${role.role} “${e.name}”` : callsignOf(role.role, nth), nth, isNamed: !!e.name,
      description: e.description || e.subagentType, mission: e.prompt, subagentType: e.subagentType,
      model: started.model || e.model || e.parentModel, background: e.background, parentId: e.parentAgentId,
      startedAt: now, status: 'starting', now: { icon: '🌱', text: 'Reading its briefing' },
      steps: 0, tools: 0, files: [], inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, contextTokens: 0, costUsd: 0,
      log: [{ at: now, icon: '🚀', text: 'Deployed' }],
    }
    await update($, agents, map => ({ ...map, [id]: record }))
    await update($, order, list => kept([...list.filter(x => x !== id), id]))
    $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    return started
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const id = e.agentId ?? MAIN_ID
    if (!(await read($, agents))[id]) return yield* next(e)
    // Overrides set from the Agents tab take effect on this step.
    // A live override from the Agents tab wins; then the role's default effort from Settings.
    const o = (await read($, overrides))[id]
    const role = ((await read($, agents))[id]?.role ?? '').toLowerCase()
    const roleEffort = settingsOf(await read($, settings)).routing.byRole[role]?.effort
    const effort = o?.effort ?? (roleEffort && roleEffort !== 'default' ? roleEffort : undefined)
    const req = { ...e, ...(o?.model ? { model: o.model } : {}), ...(effort ? { effort: effort as typeof e.effort } : {}) }
    await patch($, id, a => ({ ...a, status: 'thinking', steps: a.steps + 1, model: req.model || a.model, effort: typeof req.effort === 'string' ? req.effort : a.effort, now: { icon: '🧠', text: 'Thinking…' } }))
    const stream = next(req)
    let isWriting = false
    for (;;) {
      const step = await stream.next()
      if (step.done) return step.value
      const chunk = step.value
      if (chunk.kind === 'text' && !isWriting) {
        isWriting = true
        await patch($, id, a => ({ ...a, status: 'writing', now: { icon: '💬', text: 'Writing its report' } }))
      } else if (chunk.kind === 'stop' && chunk.usage) {
        const u = chunk.usage
        await patch($, id, a => ({
          ...a,
          inputTokens: a.inputTokens + u.input_tokens, outputTokens: a.outputTokens + u.output_tokens,
          cacheRead: a.cacheRead + u.cache_read_input_tokens, cacheWrite: a.cacheWrite + u.cache_creation_input_tokens,
          contextTokens: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens,
          costUsd: (a.costUsd || 0) + costOf(u.model || a.model, u), model: u.model || a.model,
        }))
      }
      yield chunk
    }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN_ID
    if ((await read($, agents))[id]) {
      const at = await $.clock.now()
      const input = e as unknown as Record<string, unknown>
      if (STEP_TOOLS.includes(String(e.tool))) {
        const num = (k: string) => (typeof input[k] === 'number' ? Math.max(0, Math.round(input[k] as number)) : undefined)
        const note = typeof input.note === 'string' ? input.note.trim() : ''
        await patch($, id, a => {
          const total = num('total') ?? a.stepTotal ?? 0
          const done = num('done') ?? a.stepDone ?? 0
          const reported = { ...a, stepTotal: total, stepDone: total ? Math.min(total, done) : done, stepNote: note || a.stepNote }
          return note ? logged(reported, at, '📍', note) : reported
        })
        if (String(e.tool) === OWN_STEP) return { result: 'ok' } as never
      } else {
        const what = describeTool(String(e.tool), input)
        await patch($, id, a => logged({
          ...a, status: 'tool', tools: a.tools + 1, now: { icon: what.icon, text: what.text },
          files: what.file && !a.files.includes(what.file) ? [...a.files, what.file].slice(-30) : a.files,
        }, at, what.icon, what.text))
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', { reason: ['answer', 'aborted', 'refusal', 'error'] }, async ($, e, next) => {
    const id = e.agentId ?? MAIN_ID
    const mine = (await read($, agents))[id]
    if (mine?.isMain) {
      // The main agent goes back to waiting; only an error makes it need you.
      const at = await $.clock.now()
      const isError = e.reason === 'error' || e.reason === 'refusal'
      const t = isError ? `Stopped: ${e.reason === 'refusal' ? 'the model refused' : 'an API error'}` : e.isAborted ? 'Interrupted · waiting for you' : 'Answered · waiting for you'
      await patch($, id, a => logged({ ...a, status: isError ? 'failed' : 'idle', now: { icon: isError ? '💥' : '✅', text: t }, ...(isError ? { error: t } : { error: undefined }), answer: e.answer ?? a.answer }, at, isError ? '💥' : '✅', t))
    } else if (mine) {
      const at = await $.clock.now()
      const status: AgentRecord['status'] = e.isAborted ? 'stopped' : e.reason === 'answer' ? 'done' : 'failed'
      const u = e.usage
      const isFallback = mine.steps === 0 && u !== undefined
      const icon = status === 'done' ? '✅' : status === 'failed' ? '💥' : '⏹️'
      const t = status === 'done' ? `Finished in ${fmtTime(at - mine.startedAt)}` : status === 'failed' ? `Stopped: ${e.reason === 'refusal' ? 'the model refused' : 'an API error'}` : 'Stopped'
      await patch($, id, a => logged({
        ...a, status, endedAt: at, answer: e.answer, now: { icon, text: t },
        ...(status === 'failed' ? { error: t } : {}),
        ...(isFallback && u ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, costUsd: costOf(u.model || a.model, u) } : {}),
      }, at, icon, t))
      const s = settingsOf(await read($, settings))
      if (status !== 'done' || s.show.toastsAll) $.ui.toast(`${nameOf(mine, s)} ${status === 'done' ? `finished · ${fmtTime(at - mine.startedAt)} · $${(mine.costUsd || 0).toFixed(2)}` : status === 'failed' ? `needs you: ${t}` : 'stopped'}`)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const r = await next(e)
    const at = await $.clock.now()
    const text0 = String(e.text ?? '').trim()
    if (text0 && !text0.startsWith('/')) {
      await patch($, MAIN_ID, a => logged({ ...a, mission: text0, status: 'starting', error: undefined, now: { icon: '🌱', text: 'Reading your prompt' } }, at, '💬', 'New prompt'))
    }
    return r
  })

  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    // The main agent joins the list from the start, first in line.
    const now0 = await $.clock.now()
    if (!(await read($, agents))[MAIN_ID]) {
      let model = ''
      try { model = String(((await $.session.usage()) as { model?: string }).model ?? '') } catch { /* the first step names it */ }
      await update($, agents, m => ({ ...m, [MAIN_ID]: mainRecord(now0, model) }))
    }
    await update($, order, l => [MAIN_ID, ...l.filter(x => x !== MAIN_ID)])
    const started = await next(e)
    // Workers report real progress through this tool; the Agents tab shows it as a real bar.
    await $.tool.register({
      name: 'step',
      description: 'For sub-agents: report progress on your own task to Mission Control. Right after reading your brief call it with total (your plan in 3-8 steps) and done: 0, then again as each step finishes. Cheap and silent.',
      inputSchema: { type: 'object', properties: { done: { type: 'integer', minimum: 0 }, total: { type: 'integer', minimum: 1 }, note: { type: 'string', description: 'The step in progress, a few words.' } }, required: ['done'] },
    })
    $.clock.every(5000, () => {
      void (async () => {
        const all = await read($, agents)
        if (!Object.values(all).some(isLive)) return
        const roster = await $.agent.list()
        const now = await $.clock.now()
        for (const row of roster) {
          const mine = all[row.id]
          if (!mine || !isLive(mine)) continue
          const ended = row.status === 'killed' ? 'stopped' : row.status === 'failed' ? 'failed' : row.status === 'completed' ? 'done' : undefined
          if (ended) await patch($, row.id, a => logged({ ...a, status: ended, endedAt: now, now: { icon: ended === 'done' ? '✅' : '⏹️', text: WORD[ended] } }, now, '⏹️', WORD[ended]))
        }
      })().catch(() => undefined)
    })
    // One slow clock for the pane. Motion is CSS and needs no redraw; real changes (a step,
    // a tool, a status) redraw through the agents value itself. Time alone redraws the panel
    // once a minute, and only while something runs and the panel is open.
    $.clock.every(5000, () => {
      void (async () => {
        const all = Object.values(await read($, agents))
        await retitle($, all)
        if (!all.some(isLive)) return
        const minute = Math.floor((await $.clock.now()) / 60_000)
        if (minute === clockMinute.last) return
        clockMinute.last = minute
        if (!(await $.ui.panes().catch(() => [])).some(p => p.id === PANE)) return
        await update($, tick, n => (n + 1) % 1_000_000)
      })().catch(() => undefined)
    })
    return started
  })

  // The Agents tab, the collapsed panel, and any tab no feature file claims.
  on('ui.render', { component: 'Pane', requestId: 'mission-control' }, async ($, e, next) => {
    const ui = $.ui.resolve(e)
    await read($, tick)
    const p = { ...DEFAULT_PANEL, ...(await read($, panel)) }
    const s = settingsOf(await read($, settings))
    const tab = activeTab(p.tab, s)
    if (FEATURE_TABS.includes(tab)) return next(e)
    const c = makeCtx(e, ui, await $.clock.now())
    const { Box } = ui
    const badges = badgesFrom(await read($, agents), await read($, delegations), await read($, board))
    return (
      <Box flexDirection="column" gap={1}>
        {tabBar(ui, 'agents', badges, s, t => void update($, panel, q => ({ ...q, tab: t })), c.isDesktop ? c.W : 0, c.at)}
        {await renderAgentsTab($, c)}
      </Box>
    )
  }).catch(($, e, next) => paneFailed($, e, next.error, 'agents'))
}

// ---------------------------------------------------------------- the panel's title
// The pane's title carries a sign of the state, animated while agents work: a turning
// half-circle while working, a warning when one needs you, a satellite when all is quiet.
// Only an open pane is retitled, so closing it is never undone.
const title = { last: '' }
const clockMinute = { last: -1 }
export function titleFor(list: AgentRecord[]): string {
  const needs = list.filter(a => a.status === 'failed').length
  const working = list.filter(isLive).length
  if (needs) return `⚠ ${TITLE} · ${needs} need${needs > 1 ? '' : 's'} you`
  if (working) return `● ${TITLE} · ${working} working`
  return `🛰️ ${TITLE}`
}
async function retitle($: EngineInterface, list: AgentRecord[]) {
  const panes = await $.ui.panes().catch(() => [])
  if (!panes.some(p => p.id === PANE)) return
  const next = titleFor(list)
  if (next === title.last) return
  title.last = next
  await $.ui.open({ id: PANE, title: next }).catch(() => undefined)
}

// ---------------------------------------------------------------- actions
async function retry($: EngineInterface, a: AgentRecord) {
  await $.agent.spawn({ prompt: a.mission, description: a.description, subagentType: a.subagentType }).catch(() => undefined)
}
async function stop($: EngineInterface, a: AgentRecord) {
  const r = await $.tool.call({ tool: 'TaskStop', task_id: a.id } as never).catch((err: unknown) => ({ failed: err }))
  if (r && typeof r === 'object' && 'failed' in r) $.ui.toast(`Could not stop ${a.callsign}`)
}
async function sendNote($: EngineInterface, a: AgentRecord, t: string) {
  if (!t.trim()) return
  await $.session.send({ to: { agentId: a.id }, text: t.trim() }).catch(() => $.ui.toast(`Could not reach ${a.callsign}`))
}

// ---------------------------------------------------------------- desktop drawings
const ROW_H = 66
// The costume a role wears: Settings › Characters, keyed by lowercase role.
const costumeFor = (cos: Record<string, string>, a: AgentRecord) => cos[a.role.toLowerCase()] || undefined

// part: 'top' draws the avatar, name, time and bar (44 px); 'chips' draws the chips row
// alone (20 px), so a host button can sit beside it inside the card.
function rowSvg(W: number, a: AgentRecord, at: number, theme: 'follow' | 'light' | 'dark', motion: 'full' | 'calm' | 'off', cos: Record<string, string> = {}, part: 'top' | 'chips' = 'top') {
  const X = 42, tw = W - X - 4
  const p = prog(a)
  const live = isLive(a)
  const word = statusWord(X + Math.min(textWidth(a.callsign, 12.5) + 8, tw * 0.5), 3, WORD[a.status], a.status === 'failed' ? 'fail' : a.status === 'done' ? 'ok' : a.status === 'stopped' ? 'muted' : 'live', a.color)
  let cx = X
  const chips: string[] = []
  const c1 = chip(cx, 46, `${modelOf(a)}${a.routedWhy ? ` · ${a.routedWhy}` : ''}`, 'plain', 'route'); chips.push(c1.svg); cx += c1.w + 4
  if (a.tests) { const c = chip(cx, 46, `Tests ${a.tests.passed} ✓${a.tests.failed ? ` ${a.tests.failed} ✗` : ''}`, a.tests.failed ? 'fail' : 'ok', 'shield'); chips.push(c.svg); cx += c.w + 4 }
  if (a.blocked) { const c = chip(cx, 46, `${a.blocked} command${a.blocked > 1 ? 's' : ''} blocked`, 'warn', 'shield'); chips.push(c.svg); cx += c.w + 4 }
  if (cx < W - 120) { const c = chip(cx, 46, `${fmtTokens(tokensOf(a))} · $${(a.costUsd || 0).toFixed(2)}`, 'plain'); chips.push(c.svg); cx += c.w + 4 }
  if (part === 'chips') return svg(Math.ceil(cx + 4), 20, `<g transform="translate(0,-44)">${chips.join('')}</g>`, theme, motion)
  return fsvg(44, `${avatar(0, 4, 32, a.role, a.color, live, a.status === 'failed' || a.status === 'stopped', costumeFor(cos, a))}
${text(X, 15, a.callsign, { size: 12.5, weight: 600, max: tw * 0.5 })}${word.svg}
${right(text(-2, 15, fmtSpan(elapsed(a, at)), { size: 11, cls: 's', anchor: 'end' }))}
${fprogress(X, 28, p.ratio, p.kind, a.color, p.count, live)}
`, theme, motion)
}

function focusSvg(W: number, a: AgentRecord, at: number, theme: 'follow' | 'light' | 'dark', motion: 'full' | 'calm' | 'off', cos: Record<string, string> = {}) {
  const H = 118, X = 64, tw = W - X - 12
  const p = prog(a)
  return wide(W, H, `${box(0, 0, W, H, 'ft', 8)}${outline(0, 0, W, H, 'fail', 8)}
<circle class="fl" cx="15" cy="15" r="3.5"/>${label(24, 19, 'Needs you')}${text(W - 10, 19, fmtSpan(elapsed(a, at)), { size: 11, cls: 's', anchor: 'end' })}
${avatar(10, 30, 46, a.role, a.color, false, true, costumeFor(cos, a))}
${text(X, 44, a.callsign, { size: 14, weight: 600, max: tw })}
<text x="${X}" y="60" font-size="11" font-family="-apple-system,'Segoe UI',sans-serif"><tspan style="fill:${a.color}" font-weight="600">${a.role}</tspan><tspan class="s"> · ${clip(`${a.description} · ${modelOf(a)}`, 52)}</tspan></text>
${iconInk('alert', X, 68, 13, 'fail')}${text(X + 18, 79, a.error ?? a.now.text, { size: 12, max: tw - 18 })}
${progress(X, 92, tw, p.ratio, 'halted', a.color, p.count)}
${text(X, 112, `${fmtTokens(tokensOf(a))} tok · $${(a.costUsd || 0).toFixed(2)} · ctx ${ctxPct(a)}%`, { size: 11, cls: 's' })}`, theme, motion)
}

function headerSvg(W: number, list: AgentRecord[], spend: [string, string], at: number, theme: 'follow' | 'light' | 'dark') {
  const live = list.filter(isLive).length
  const tokens = list.reduce((n, a) => n + tokensOf(a), 0)
  const start = list.length ? Math.min(...list.map(a => a.startedAt)) : at
  const figs: [string, string][] = [['Working', `${live} / ${list.length}`], ['Tokens', fmtTokens(tokens)], spend, ['Time', fmtSpan(list.length ? at - start : 0)]]
  const rate = rateHistory[rateHistory.length - 1] ?? 0
  // Four columns at quarters of the width; placed by percent, so text keeps its size.
  const col = (i: number, inner: string) => `<svg x="${i * 25}%" y="0" width="25%" height="44" overflow="visible">${inner}</svg>`
  const vals = rateHistory.length ? rateHistory : [0, 0]
  const max = Math.max(...vals, 1)
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * 100).toFixed(2)},${(18 - (v / max) * 18).toFixed(2)}`).join(' ')
  const sparkSvg = `<svg x="62" y="50" height="18" style="width:calc(100% - 140px)" viewBox="0 0 100 18" preserveAspectRatio="none" overflow="visible"><polygon points="${pts} 100,18 0,18" style="fill:#378add;opacity:.14"/><polyline points="${pts}" fill="none" style="stroke:#378add" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`
  return fsvg(76, `${figs.map(([k, v], i) => col(i, `${i ? `<line class="ln" x1="0" y1="4" x2="0" y2="38"/>` : ''}${label(i ? 10 : 0, 13, k)}${text(i ? 10 : 0, 33, v, { size: 15, weight: 600 })}`)).join('')}
${label(0, 63, 'Output')}${sparkSvg}${right(text(0, 63, `${fmtTokens(rate)}/min`, { size: 11.5, weight: 600, anchor: 'end' }))}`, theme)
}

// Your team: a strip a shade darker than the pane, its title and counts on top, then each
// agent as its crab with a status bubble and its name in a chip, light lines between them.
const TEAM_BG = (theme: 'follow' | 'light' | 'dark') => theme === 'dark' ? '.teambg{fill:#171615}' : theme === 'light' ? '.teambg{fill:#f0efea}' : '.teambg{fill:#f0efea}@media (prefers-color-scheme: dark){.teambg{fill:#171615}}'
export const TEAM_H = 120
function teamSvg(list: AgentRecord[], theme: 'follow' | 'light' | 'dark', motion: 'full' | 'calm' | 'off', cos: Record<string, string>, nameOf: (a: AgentRecord) => string) {
  const live = list.filter(isLive).length, needs = list.filter(a => a.status === 'failed').length
  const cell = 92
  const cells = list.slice(0, 14).map((a, i) => {
    const x = 12 + i * cell
    const name = nameOf(a).replace(/ - \((.*)\)$/, '')
    const cw = Math.min(cell - 10, textWidth(name, 10.5) + 14)
    return (i ? `<line class="ln" x1="${x - 6}" y1="40" x2="${x - 6}" y2="${TEAM_H - 10}"/>` : '')
      + avatar(x + (cell - 12 - 34) / 2, 52, 34, a.role, a.color, isLive(a), a.status === 'failed' || a.status === 'stopped', costumeFor(cos, a))
      + (a.status === 'failed' ? outline(x + (cell - 12 - 34) / 2, 52, 34, 34, 'fail', 6) : '')
      + bubble(x + (cell - 12 - 34) / 2 + 7, 33, bubbleOf(a))
      + `<rect class="tile" x="${x + (cell - 12 - cw) / 2}" y="92" width="${cw}" height="18" rx="5"/>`
      + text(x + (cell - 12) / 2, 105, name, { size: 10.5, weight: 600, anchor: 'middle', max: cw - 8 })
  }).join('')
  const summary = `${list.length} agent${list.length === 1 ? '' : 's'} · ${live} working${needs ? ` · ${needs} need${needs > 1 ? '' : 's'} you` : ''}`
  return fsvg(TEAM_H, `<style>${TEAM_BG(theme)}</style><rect class="teambg" x="0" y="0" width="100%" height="${TEAM_H}" rx="10"/>`
    + `<text class="s" x="12" y="22" font-family="${FONT}" font-size="10.5" font-weight="700" letter-spacing=".8">YOUR TEAM</text>`
    + right(text(-12, 22, summary, { size: 11.5, cls: needs ? 'fl' : 's', anchor: 'end' }))
    + cells, theme, motion)
}

function squadSvg(W: number, list: AgentRecord[], theme: 'follow' | 'light' | 'dark', motion: 'full' | 'calm' | 'off', withTotals?: string, cos: Record<string, string> = {}) {
  const pitch = 36
  const fit = Math.max(1, Math.floor((W - (withTotals ? textWidth(withTotals, 11.5) + 16 : 0)) / pitch))
  const shown = list.slice(0, fit)
  const more = list.length - shown.length
  return wide(W, 56, `${shown.map((a, i) => `${avatar(i * pitch, 22, 30, a.role, a.color, isLive(a), a.status === 'failed' || a.status === 'stopped', costumeFor(cos, a))}${a.status === 'failed' ? outline(i * pitch, 22, 30, 30, 'fail', 6) : ''}${bubble(i * pitch + 5, 2, bubbleOf(a))}`).join('')}
${more ? text(shown.length * pitch + 4, 42, `+${more}`, { size: 12, cls: 's' }) : ''}${withTotals ? text(W, 42, withTotals, { size: 11.5, cls: 's', anchor: 'end' }) : ''}
`, theme, motion)
}

// ---------------------------------------------------------------- details
// The expanded agent on desktop, as one drawing in sections: its figures, context, what
// it is working with, the mission, a timeline of what it did, the files and its report.
function detailsSvg(W: number, a: AgentRecord, at: number, theme: 'follow' | 'light' | 'dark', motion: 'full' | 'calm' | 'off'): { H: number; svg: string } {
  const P = 12, w = W - P * 2
  let y = P
  const out: string[] = []
  const head = (t: string) => { out.push(label(P, y + 10, t)); y += 18 }
  // Figures: four columns split by hairlines, as in the tab header.
  const mins = Math.max(1 / 6, elapsed(a, at) / 60000)
  const figs: [string, string][] = [
    ['Tokens', fmtTokens(tokensOf(a))],
    ['In / out', `${fmtTokens(a.inputTokens + a.cacheRead + a.cacheWrite)} / ${fmtTokens(a.outputTokens)}`],
    ['Output rate', `${fmtTokens(a.outputTokens / mins)}/min`],
    ['Cost', `≈$${(a.costUsd || 0).toFixed(2)}`],
  ]
  const cw = w / 4
  figs.forEach(([k, v], i) => {
    const x = P + i * cw + (i ? 8 : 0)
    if (i) out.push(`<line class="ln" x1="${P + i * cw}" y1="${y}" x2="${P + i * cw}" y2="${y + 32}"/>`)
    out.push(label(x, y + 10, k) + text(x, y + 28, v, { size: 13, weight: 600, max: cw - 12 }))
  })
  y += 44
  // Context: how full its window is.
  const pct = ctxPct(a)
  out.push(text(P, y + 8, 'Context', { size: 11, cls: 's' }) + meter(P + 56, y + 3, Math.max(40, w - 56 - 130), pct / 100, pct >= 85 ? 'fail' : pct >= 65 ? 'warn' : 'ink')
    + text(W - P, y + 8, `${pct}% · ${fmtTokens(a.contextTokens)} of ${fmtTokens(windowOf(a.model))}`, { size: 11, cls: 's', anchor: 'end' }))
  y += 22
  // What it is working with, as chips.
  let cx = P
  for (const [t, ic] of [[`${a.steps} steps`, 'list'], [`${a.tools} tools`, 'gear'], [`${a.files.length} files`, 'folder'], [modelOf(a), 'route']] as [string, string][]) {
    const c = chip(cx, y, t, 'plain', ic)
    if (cx + c.w > W - P) break
    out.push(c.svg)
    cx += c.w + 6
  }
  y += 28
  out.push(hline(P, W - P, y))
  y += 10
  // Mission, wrapped, at most six lines.
  head('Mission')
  const lines = wrap(a.mission.replace(/\s+/g, ' ').trim() || '—', 12, w)
  const shown = lines.slice(0, 6)
  if (lines.length > 6) shown[5] = fitText(`${shown[5]} …`, 12, w)
  shown.forEach((l, i) => out.push(text(P, y + 12 + i * 17, l, { size: 12 })))
  y += shown.length * 17 + 10
  // Recent activity as a timeline: a rail, a dot per step, its icon, what it did, how long ago.
  const log = a.log.slice(-8).reverse()
  if (log.length) {
    out.push(hline(P, W - P, y))
    y += 10
    head('Recent activity')
    const top = y
    out.push(`<line class="ln" x1="${P + 5}" y1="${top + 9}" x2="${P + 5}" y2="${top + (log.length - 1) * 24 + 9}" stroke-width="1.5"/>`)
    log.forEach((l, i) => {
      const yy = y + i * 24
      const isNow = i === 0 && isLive(a)
      out.push(`<circle cx="${P + 5}" cy="${yy + 9}" r="${isNow ? 4 : 3}" ${isNow ? `style="fill:${a.color}"` : 'class="m"'}/>`)
      out.push(iconInk(l.icon, P + 16, yy + 2, 14, isNow ? 'ink' : 'muted'))
      out.push(text(P + 36, yy + 13, l.text, { size: 12, cls: isNow ? 't' : 's', weight: isNow ? 600 : undefined, max: w - 36 - 64 }))
      out.push(text(W - P, yy + 13, fmtAgo(at - l.at), { size: 11, cls: 'm', anchor: 'end' }))
    })
    y += log.length * 24 + 6
  }
  // Files it touched, newest first.
  if (a.files.length) {
    out.push(hline(P, W - P, y))
    y += 10
    head(`Files touched · ${a.files.length}`)
    a.files.slice(-5).reverse().forEach((f, i) => {
      out.push(iconInk('folder', P, y + i * 20 + 1, 13) + text(P + 20, y + i * 20 + 12, f.length > 70 ? `…${f.slice(-68)}` : f, { size: 11.5, mono: true, cls: 's', max: w - 20 }))
    })
    y += Math.min(5, a.files.length) * 20 + 6
  }
  // Its report, once it has finished.
  if (a.answer && !isLive(a)) {
    out.push(hline(P, W - P, y))
    y += 10
    head('Report')
    const r = wrap(a.answer.replace(/\s+/g, ' ').trim(), 12, w).slice(0, 8)
    r.forEach((l, i) => out.push(text(P, y + 12 + i * 17, l, { size: 12 })))
    y += r.length * 17 + 8
  }
  const H = y + P - 4
  return { H, svg: wide(W, H, box(0.5, 0.5, W - 1, H - 1, 'tile', 8) + out.join(''), theme, motion) }
}

// The expanded agent: the drawing on desktop, the same facts as text in the terminal.
function detailsBlock(ctx: TabCtx, a: AgentRecord, theme: 'follow' | 'light' | 'dark', motion: 'full' | 'calm' | 'off'): RenderElement {
  const Svg = 'Svg' in ctx.ui ? ctx.ui.Svg : undefined
  if (!ctx.isDesktop || !Svg) return details(ctx, a)
  const d = detailsSvg(ctx.W, a, ctx.at, theme, motion)
  return <Svg key={`det-${a.id}`} source={d.svg} alt={`${a.callsign}: ${fmtTokens(tokensOf(a))} tokens, $${(a.costUsd || 0).toFixed(2)}. Mission: ${clip(a.mission, 200)}. Latest: ${a.log.slice(-3).reverse().map(l => l.text).join('; ')}`} height={d.H} />
}

// ---------------------------------------------------------------- details as text (terminal)
function details(ctx: TabCtx, a: AgentRecord): RenderElement {
  const { Box, Text } = ctx.ui
  return (
    <Box key={`det-${a.id}`} flexDirection="column" paddingLeft={ctx.isDesktop ? 0 : 3}>
      <Text wrap="truncate-end">{`Tokens ${fmtTokens(tokensOf(a))} · in ${fmtTokens(a.inputTokens + a.cacheRead + a.cacheWrite)} / out ${fmtTokens(a.outputTokens)} · ${fmtTokens(a.outputTokens / Math.max(1 / 6, elapsed(a, ctx.at) / 60000))}/min · $${(a.costUsd || 0).toFixed(2)}`}</Text>
      <Text dimColor wrap="truncate-end">{`Context ${ctxPct(a)}% · ${fmtTokens(a.contextTokens)} · ${a.steps} steps · ${a.tools} tools · ${a.files.length} files · ${modelOf(a)}`}</Text>
      <Text bold dimColor>MISSION</Text>
      <Text wrap="wrap">{clip(a.mission, 700)}</Text>
      <Text bold dimColor>RECENT ACTIVITY</Text>
      {a.log.slice(-8).reverse().map((l, i) => (
        <Text key={`log-${a.id}-${i}`} dimColor={i > 0} wrap="truncate-end">{`${fmtAgo(ctx.at - l.at)} · ${l.text}`}</Text>
      ))}
      {a.files.length > 0 && <Text bold dimColor>FILES TOUCHED</Text>}
      {a.files.slice(-6).map((f, i) => <Text key={`f-${a.id}-${i}`} dimColor wrap="truncate-start">{f}</Text>)}
      {a.answer && !isLive(a) && <Text bold dimColor>REPORT</Text>}
      {a.answer && !isLive(a) && <Text wrap="wrap">{clip(a.answer, 900)}</Text>}
    </Box>
  )
}

function controls($: EngineInterface, ctx: TabCtx, a: AgentRecord): RenderElement {
  const { ui } = ctx
  const { Box, Button, Text } = ui
  const Select = 'Select' in ui ? ui.Select : undefined
  const Input = 'Input' in ui ? ui.Input : undefined
  const setO = (k: 'model' | 'effort') => (v: string) => update($, overrides, m => ({ ...m, [a.id]: { ...m[a.id], [k]: v as never } }))
  return (
    <Box key={`ctl-${a.id}`} flexDirection="column" gap={1} marginTop={1}>
      {Select && (isLive(a) || a.isMain) && (
        <Box flexDirection="row" gap={1}>
          <Select key={`model-${a.id}`} label="Model" value={MODELS.find(m => m.includes(a.model.replace(/^claude-/, '').split('-')[0] ?? '')) ?? MODELS[2]} options={MODELS.map(m => ({ value: m, label: modelName(m) }))} onSelect={setO('model')} />
          <Select key={`effort-${a.id}`} label="Effort" value={a.effort ?? 'medium'} options={EFFORTS.map(x => ({ value: x, label: x[0]!.toUpperCase() + x.slice(1) }))} onSelect={setO('effort')} />
        </Box>
      )}
      {(isLive(a) || a.isMain) && <Text dimColor>{a.isMain ? 'Model and effort apply from the next step of this session.' : 'Model and effort apply from its next step.'}</Text>}
      {Input && isLive(a) && !a.isMain && <Input key={`note-${a.id}`} placeholder="Send a note to this agent" submitLabel="Send" onSubmit={v => sendNote($, a, v)} />}
      <Box flexDirection="row" gap={1}>
        {isLive(a) && !a.isMain && <Button key={`stop-${a.id}`} label="Stop" onPress={() => stop($, a)} />}
        {!isLive(a) && !a.isMain && a.status !== 'done' && <Button key={`retry2-${a.id}`} label="Retry" onPress={() => retry($, a)} />}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------- the tab
async function renderAgentsTab($: EngineInterface, ctx: TabCtx): Promise<RenderElement> {
  const { ui, isDesktop, W, at } = ctx
  const { Box, Text, Button } = ui
  const Svg = 'Svg' in ui ? ui.Svg : undefined
  const all = await read($, agents)
  const ids = await read($, order)
  const p = await read($, panel)
  const s = settingsOf(await read($, settings))
  const b = await read($, budget)
  // Names follow Settings › Names live, so a change there renames every row at once.
  const list = ids.map(id => all[id]).filter((a): a is AgentRecord => a !== undefined).map(a => ({ ...a, callsign: nameOf(a, s) }))
  sampleRate(list, at)
  const main = list.find(a => a.isMain)
  const subs = list.filter(a => !a.isMain)
  const needs = subs.filter(a => a.status === 'failed').reverse()
  const running = subs.filter(isLive).reverse()
  const finished = subs.filter(a => a.status === 'done' || a.status === 'stopped').sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0))
  const focus = needs[0]
  const others = [...needs.slice(1), ...running]
  const spent = b.spentToday || list.reduce((n, a) => n + (a.costUsd || 0), 0)
  // On a plan the figure that matters is the window, not dollars.
  const spend: [string, string] = planMode(s, b) && b.fiveHour ? ['5-hour', `${Math.round(b.fiveHour.pct)}%`] : ['Today', fmtCost(spent)]
  const theme = s.look.theme, motion = s.look.motion
  const toggle = (id: string) => () => update($, panel, q => ({ ...q, expanded: { ...q.expanded, [id]: !q.expanded[id] } }))

  if (list.length === 0) {
    return emptyState(ctx, s.look, 'agents', 'No agents yet', 'When Claude starts a sub-agent it appears here with its role, what it is doing, its progress and its cost.', 'scout', '#378ADD')
  }
  const noSubs = 'No sub-agents yet. When Claude starts one it appears here with its role, progress and cost.'

  if (isDesktop && Svg) {
    // An agent's card: the drawing, with the Details toggle placed inside it at the bottom
    // right, level with the chips; the details open under the card, then a hairline.
    const row = (a: AgentRecord) => (
      <Box key={`row-${a.id}`} flexDirection="column">
        <Svg source={rowSvg(W, a, at, theme, motion, s.costumes)} alt={`${a.callsign}, ${WORD[a.status]}, ${a.now.text}, ${Math.round(prog(a).ratio * 100)}%`} height={44} />
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" width="100%" marginBottom={1}>
          <Svg source={rowSvg(W, a, at, theme, motion, s.costumes, 'chips')} alt={`${modelOf(a)}, ${fmtTokens(tokensOf(a))} tokens, $${(a.costUsd || 0).toFixed(2)}`} height={20} />
          <Button key={`more-${a.id}`} label={p.expanded[a.id] ? 'Hide details  ▴' : 'Details  ▾'} dimColor={p.expanded[a.id] ? undefined : true} onPress={toggle(a.id)} />
        </Box>
        {p.expanded[a.id] && <Box flexDirection="column" gap={1} marginTop={1}>{detailsBlock(ctx, a, theme, motion)}{controls($, ctx, a)}</Box>}
        {a.isMain ? null : divider(ctx, s.look, `row-${a.id}`)}
      </Box>
    )
    return (
      <Box flexDirection="column">
        <Svg source={headerSvg(W, list, spend, at, theme)} alt={`${list.filter(isLive).length} of ${list.length} agents working, ${spend[0]} ${spend[1]}`} height={76} />
        <Box marginTop={1} marginBottom={1} flexDirection="column">
          <Svg source={teamSvg(list, theme, motion, s.costumes, a => a.callsign)} alt={`Your team: ${list.map(a => a.callsign).join(', ')}`} height={TEAM_H} />
        </Box>
        {focus && (
          <Box key="focus" flexDirection="column" gap={1}>
            <Svg source={focusSvg(W, focus, at, theme, motion, s.costumes)} alt={`${focus.callsign} needs you: ${focus.error ?? focus.now.text}`} height={118} />
            <Box flexDirection="row" gap={1}>
              <Button key="retry" variant="primary" label="Retry" onPress={() => retry($, focus)} />
              <Button key="showlog" label={p.expanded[focus.id] ? 'Hide log' : 'Show log'} onPress={toggle(focus.id)} />
            </Box>
            {p.expanded[focus.id] && detailsBlock(ctx, focus, theme, motion)}
          </Box>
        )}
        {main && section(ctx, s.look, 'main', 'Main session', undefined, true)}
        {main && row(main)}
        {section(ctx, s.look, 'subs', `Sub-agents · ${subs.length}`, subs.length ? `${running.length} running${needs.length ? ` · ${needs.length} need you` : ''}` : noSubs)}
        {others.map(row)}
        {finished.length > 0 && (
          <Box key="fin-head" flexDirection="row" gap={2}>
            <Button key="toggle-done" plain label={`${p.isDoneCollapsed ? '▸' : '▾'} Finished · ${finished.length}`} onPress={() => update($, panel, q => ({ ...q, isDoneCollapsed: !q.isDoneCollapsed }))} />
            <Button key="clear-done" plain label="Clear" onPress={async () => {
              const gone = new Set(finished.map(a => a.id))
              await update($, order, l => l.filter(x => !gone.has(x)))
              await update($, agents, m => Object.fromEntries(Object.entries(m).filter(([k]) => !gone.has(k))))
            }} />
          </Box>
        )}
        {!p.isDoneCollapsed && finished.map(row)}
      </Box>
    )
  }

  // Terminal and the rest: the same content as text.
  const barW = Math.max(6, Math.min(20, ctx.cols - 34))
  const glyph = (a: AgentRecord) => (isLive(a) ? '●' : a.status === 'done' ? '✓' : a.status === 'failed' ? '✗' : '■')
  const tone = (a: AgentRecord) => (isLive(a) ? a.color : a.status === 'done' ? 'success' : a.status === 'failed' ? 'error' : 'subtle')
  const trow = (a: AgentRecord) => {
    const pr = prog(a)
    return (
      <Box key={`row-${a.id}`} flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" gap={1}>
          <Text>{a.emoji}</Text><Text bold wrap="truncate-end">{a.callsign}</Text>
          <Text color={tone(a)}>{`${glyph(a)} ${WORD[a.status]}`}</Text><Text dimColor>{fmtSpan(elapsed(a, at))}</Text>
        </Box>
        <Text wrap="truncate-end">{`   ${a.now.text}`}</Text>
        <Text wrap="truncate-end">
          {'   '}
          {pr.kind === 'real' ? <Text color={a.color}>{barText(pr.ratio, barW)}</Text> : pr.kind === 'done' ? <Text color="success">{barText(1, barW)}</Text> : <Text dimColor>{pr.kind === 'est' ? estText(pr.ratio, barW) : barText(pr.ratio, barW)}</Text>}
          <Text>{`  ${pr.kind === 'est' ? '~' : ''}${Math.round(pr.ratio * 100)}%  `}</Text>
          <Text dimColor>{`${pr.count}  ${fmtTokens(tokensOf(a))} ≈$${(a.costUsd || 0).toFixed(2)} · ${modelOf(a)}`}</Text>
        </Text>
        {p.expanded[a.id] && <Box flexDirection="column">{details(ctx, a)}{controls($, ctx, a)}</Box>}
        <Button key={`more-${a.id}`} plain label={p.expanded[a.id] ? '   ▴ Hide details' : '   ▾ Details'} onPress={toggle(a.id)} />
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{`${list.some(isLive) ? '● ' : ''}${list.filter(isLive).length} live · ${list.length} agents`}</Text>

      </Box>
      <Text dimColor>{`${fmtTokens(list.reduce((n, a) => n + tokensOf(a), 0))} tokens · ${spend[0] === 'Today' ? `≈${fmtCost(spent)} today` : `5-hour window ${spend[1]} used`}`}</Text>
      {needs.length > 0 && <Text color="error">{`✗ ${needs.length} need${needs.length > 1 ? '' : 's'} you`}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {main && trow(main)}
        <Text bold dimColor>{`SUB-AGENTS · ${subs.length}`}</Text>
        {subs.length === 0 && <Text dimColor wrap="wrap">{noSubs}</Text>}
        {needs.map(trow)}
        {running.map(trow)}
        {finished.length > 0 && <Button key="toggle-done" plain label={`${p.isDoneCollapsed ? '▸' : '▾'} Finished · ${finished.length}`} onPress={() => update($, panel, q => ({ ...q, isDoneCollapsed: !q.isDoneCollapsed }))} />}
        {!p.isDoneCollapsed && finished.map(trow)}
      </Box>
    </Box>
  )
}

// The whole panel collapsed: the squad with status bubbles and one line of totals.
async function renderCollapsed($: EngineInterface, ctx: TabCtx): Promise<RenderElement> {
  const { ui, isDesktop, W } = ctx
  const { Box, Text, Button } = ui
  const Svg = 'Svg' in ui ? ui.Svg : undefined
  const all = await read($, agents)
  const s = settingsOf(await read($, settings))
  const list = (await read($, order)).map(id => all[id]).filter((a): a is AgentRecord => a !== undefined).map(a => ({ ...a, callsign: nameOf(a, s) }))
  const b = await read($, budget)
  const needs = list.filter(a => a.status === 'failed').length
  const live = list.filter(isLive).length
  const money = planMode(s, b) && b.fiveHour ? `5-hour ${Math.round(b.fiveHour.pct)}%` : `${fmtCost(b.spentToday || list.reduce((n, a) => n + (a.costUsd || 0), 0))} today`
  const totals = `${needs ? `${needs} need${needs > 1 ? '' : 's'} you · ` : ''}${live} live · ${money}`
  const expand = <Button key="expand" plain label="Expand" onPress={() => update($, panel, q => ({ ...q, isCompact: false }))} />
  if (isDesktop && Svg) {
    return (
      <Box flexDirection="column">
        <Svg source={squadSvg(W, list, s.look.theme, s.look.motion, totals, s.costumes)} alt={totals} height={56} />
        {expand}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">{list.map(a => `${a.emoji}${isLive(a) ? '●' : a.status === 'done' ? '✓' : a.status === 'failed' ? '✗' : '■'}`).join(' ')}</Text>
      <Box flexDirection="row" justifyContent="space-between"><Text dimColor>{totals}</Text>{expand}</Box>
    </Box>
  )
}

// When drawing fails, say so in the pane (and keep the reason for a bug report) instead of
// leaving it blank.
async function paneFailed($: EngineInterface, e: PaneInput, error: unknown, where: string): Promise<RenderElement> {
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : JSON.stringify(error)
  await $.store.set('lastError', { where, reason, at: await $.clock.now() }).catch(() => undefined)
  return failedView($.ui.resolve(e), where, reason)
}
