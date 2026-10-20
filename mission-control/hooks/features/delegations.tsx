// Delegations: watches the relay scripts that hand work to Codex, agy (Antigravity) and
// OpenCode, follows each run to its result.json, and draws the Delegations tab. Observes only:
// no hook here ever blocks a command, and no button runs git (each fills the composer).
import { atom, read, update } from 'claude-code'
import { failedView } from '../kit/ui'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { AgentRecord, BoardSnapshot, Delegation, DelegationTool } from '../../types'
import { emptyState } from '../kit/ui'
import { activeTab, badgesFrom, clip, tabBar } from '../kit/chrome'
import { barText, box, chip, estText, iconInk, label, outline, progress, statusWord, svg, text, textWidth, wide } from '../kit/draw'
import { fmtSpan, fmtTime } from '../kit/role'
import { expandHome, homeOf, isWindowsHome, tmpOf } from '../kit/paths'
import type { HomeEnv } from '../kit/paths'
import { DEFAULT_PANEL, DEFAULT_SETTINGS, localDay, makeCtx, settingsOf } from '../kit/state'
import type { PaneInput } from '../kit/state'
import type { TabCtx } from '../kit/state'

const agents = atom({ plugin: 'mission-control', key: 'agents' } as const, {} as Record<string, AgentRecord>)
const board = atom({ plugin: 'mission-control', key: 'board' } as const, null as BoardSnapshot | null)
const delegations = atom({ plugin: 'mission-control', key: 'delegations' } as const, {} as Record<string, Delegation>)
const delegationOrder = atom({ plugin: 'mission-control', key: 'delegationOrder' } as const, [] as string[])
const panel = atom({ plugin: 'mission-control', key: 'panel' } as const, DEFAULT_PANEL)
const settings = atom({ plugin: 'mission-control', key: 'settings' } as const, DEFAULT_SETTINGS)

const TOOLS: Record<DelegationTool, { name: string; color: string }> = {
  codex: { name: 'Codex', color: '#1f1f1f' },
  agy: { name: 'agy', color: '#378add' },
  opencode: { name: 'OpenCode', color: '#ba7517' },
  claude: { name: 'Claude', color: '#d97757' },
}
const EST_MS = 6 * 60 * 1000
const POLL_MS = 4000
const DIFF_EVERY_MS = 20000
const DEFAULT_TASK = 'Delegated task'
const BAR = '#378add'

// ---------------------------------------------------------------- pure helpers
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p
const joinPath = (a: string, b: string): string => `${a.replace(/[\\/]+$/, '')}/${b}`
const isAbs = (p: string): boolean => /^([A-Za-z]:)?[\\/]/.test(p) || p.startsWith('~')
const firstLine = (s: string): string => s.split('\n').find(l => l.trim() !== '')?.trim() ?? ''

export type RelayCall = { tool: DelegationTool; cd?: string; brief?: string; model?: string; outDir?: string; heredoc?: string; issue?: string }

// Splits on whitespace outside quotes. No escape handling, so Windows paths survive.
export function tokenize(cmd: string): string[] {
  const out: string[] = []
  let cur = '', q = '', has = false
  for (const ch of cmd) {
    if (q) {
      if (ch === q) q = ''
      else cur += ch
    } else if (ch === '"' || ch === "'") { q = ch; has = true }
    else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur)
      cur = ''; has = false
    } else cur += ch
  }
  if (cur || has) out.push(cur)
  return out
}

// Recognises `node <x>-delegate/scripts/relay.mjs …` and reads its flags.
export function parseRelay(command: unknown): RelayCall | null {
  const cmd = str(command)
  const m = /(codex|agy|opencode|claude)-delegate[\\/]+scripts[\\/]+relay\.mjs/.exec(cmd)
  if (!m) return null
  const tool = m[1] as DelegationTool
  const tokens = tokenize(cmd)
  const at = tokens.findIndex(t => /relay\.mjs$/.test(t))
  const args: string[] = []
  for (const t of tokens.slice(at + 1)) {
    if (['&&', '||', '|', ';', '&', '>', '>>', '2>&1'].includes(t)) break
    args.push(t)
  }
  const flag = (name: string): string | undefined => {
    const i = args.findIndex(a => a === name || a.startsWith(`${name}=`))
    if (i < 0) return undefined
    const a = args[i] ?? ''
    return a.includes('=') ? a.slice(name.length + 1) : args[i + 1]
  }
  const hd = /<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\s*\1\b/.exec(cmd)
  // A run wrapped by Mission Control's run-log names its GitHub issue: `run-log.mjs start --issue 28`.
  const issue = /--issue[=\s]+["']?#?(\d{1,7})\b/.exec(cmd)?.[1]
  return { tool, cd: flag('--cd'), brief: flag('--brief'), model: flag('--model'), outDir: flag('--out-dir'), heredoc: hd?.[2], ...(issue ? { issue } : {}) }
}

export function taskOf(brief: string): string {
  const line = firstLine(brief).replace(/^[#>*\-\s]+/, '').replace(/^(task|title|ticket)\s*:\s*/i, '').trim()
  return line ? clip(line, 90) : DEFAULT_TASK
}
// What the run is for: the GitHub issue the command names, else one the brief names (#28),
// else an .ops ticket id (M0-007).
export function ticketOf(brief: string, issue?: string): string | undefined {
  if (issue) return `#${issue}`
  const head = brief.slice(0, 800)
  const gh = /(?:^|[\s(])#(\d{1,7})\b/.exec(head)?.[1]
  return gh ? `#${gh}` : /\b[A-Z][A-Z0-9]{0,6}-\d{2,5}\b/.exec(head)?.[0]
}

export function parseShortstat(s: string): { files: number; added: number; removed: number } | undefined {
  const f = /(\d+)\s+files?\s+changed/.exec(s)
  if (!f) return undefined
  return { files: Number(f[1]), added: Number(/(\d+)\s+insertions?/.exec(s)?.[1] ?? 0), removed: Number(/(\d+)\s+deletions?/.exec(s)?.[1] ?? 0) }
}

function testsFrom(r: Record<string, unknown>, msg: string): Delegation['tests'] {
  const t = r.tests
  if (isObj(t) && (num(t.passed) !== undefined || num(t.failed) !== undefined)) return { passed: num(t.passed) ?? 0, failed: num(t.failed) ?? 0, ran: true }
  const p = /(\d+)\s+(?:tests?\s+)?(?:passed|passing)/i.exec(msg)
  const f = /(\d+)\s+(?:tests?\s+)?(?:failed|failing)/i.exec(msg)
  return p || f ? { passed: Number(p?.[1] ?? 0), failed: Number(f?.[1] ?? 0), ran: true } : undefined
}

// What a result.json tells us. Any shape is accepted; unknown fields are ignored.
export function applyResult(raw: unknown, now: number): Partial<Delegation> {
  const r = isObj(raw) ? raw : {}
  const st = str(r.status)
  const exit = num(r.exitCode)
  const bad = (st !== '' && st !== 'completed') || (exit !== undefined && exit !== 0)
  const finalMessage = str(r.finalMessage) || str(r.final)
  const tail = Array.isArray(r.stderrTail) ? r.stderrTail.filter(x => typeof x === 'string').slice(-3).join(' ') : str(r.stderrTail)
  const error = bad ? (str(r.error) || tail || st || `exit ${exit}`) : undefined
  const finished = Date.parse(str(r.finishedAt))
  const touched = Array.isArray(r.touchedFiles) ? r.touchedFiles.length : undefined
  const model = str(r.model)
  const tests = testsFrom(r, finalMessage)
  return {
    status: bad ? 'failed' : 'review',
    endedAt: Number.isFinite(finished) ? finished : now,
    now: bad ? clip(firstLine(error ?? '') || 'Failed', 110) : 'Finished, waiting for your review',
    ...(finalMessage ? { finalMessage } : {}),
    ...(error ? { error } : {}),
    ...(model ? { model } : {}),
    ...(touched !== undefined ? { files: touched } : {}),
    ...(tests ? { tests } : {}),
  }
}

// A run record from <repo>/.ops/runs/<ticket>/*.json; null when it is not a finished delegation.
export function fromRun(raw: unknown, id: string, project: string, cwd: string, ticket: string, fallbackAt: number): Delegation | null {
  if (!isObj(raw)) return null
  const blob = `${str(raw.tool)} ${str(raw.agent)} ${str(raw.implementer)}`
  const tool: DelegationTool | undefined = /codex/i.test(blob) || 'codexVersion' in raw ? 'codex'
    : /agy|antigravity/i.test(blob) || 'agyVersion' in raw ? 'agy'
    : /opencode/i.test(blob) || 'opencodeVersion' in raw ? 'opencode'
    : /claude/i.test(blob) || 'claudeVersion' in raw ? 'claude' : undefined
  if (!tool || (str(raw.status) !== '' && str(raw.status) !== 'completed')) return null
  const verdict = `${str(raw.verdict)} ${str(raw.review)} ${str(raw.reviewVerdict)}`
  const started = Date.parse(str(raw.startedAt))
  const ended = Date.parse(str(raw.finishedAt))
  const msg = str(raw.finalMessage)
  const base = applyResult(raw, fallbackAt)
  return {
    id, tool, task: taskOf(str(raw.task) || str(raw.title) || ticket), ticket: ticket || undefined, project, cwd,
    startedAt: Number.isFinite(started) ? started : (Number.isFinite(ended) ? ended : fallbackAt) - 1,
    endedAt: Number.isFinite(ended) ? ended : fallbackAt,
    status: /accept|approv|merged|landed|pass/i.test(verdict) ? 'merged' : 'done',
    now: msg ? clip(firstLine(msg), 110) : 'Finished',
    ...(base.model ? { model: base.model } : {}), ...(base.files !== undefined ? { files: base.files } : {}),
    ...(base.tests ? { tests: base.tests } : {}), ...(msg ? { finalMessage: msg } : {}),
    ...(str(raw.branch) ? { branch: str(raw.branch) } : {}),
  }
}

// A finished run from a line Mission Control's run-log.mjs wrote to .ops/log/activity.jsonl
// (`source: "run-log"`, event run.completed): runs any session delegated, joined on the issue.
// `titles` names an issue by the board's tickets ("#28" -> its title). Null for anything else.
export function fromRunLog(raw: unknown, titles: Map<string, string>): Delegation | null {
  if (!isObj(raw) || raw.source !== 'run-log' || raw.event !== 'run.completed') return null
  const d = isObj(raw.detail) ? raw.detail : {}
  const who = `${str(d.agent)} ${str(raw.actor)}`
  const tool: DelegationTool | undefined = /codex/i.test(who) ? 'codex' : /agy|antigravity/i.test(who) ? 'agy' : /opencode/i.test(who) ? 'opencode' : /claude/i.test(who) ? 'claude' : undefined
  const ended = Date.parse(str(raw.ts))
  if (!tool || !Number.isFinite(ended)) return null
  const issue = num(raw.issue)
  const ticket = issue ? `#${issue}` : str(raw.ticket) || undefined
  const cwd = str(d.worktree).replace(/\\/g, '/')
  const secs = num(d.durationSec)
  const files = num(d.touchedFiles)
  return {
    id: `log:${tool}:${str(raw.ts)}`, tool, task: (ticket && titles.get(ticket)) || (ticket ? `Issue ${ticket}` : DEFAULT_TASK),
    ...(ticket ? { ticket } : {}), project: baseName(cwd) || 'project', cwd,
    startedAt: ended - (secs && secs > 0 ? secs * 1000 : 1), endedAt: ended, status: 'done', now: 'Finished',
    ...(str(d.branch) && str(d.branch) !== 'HEAD' ? { branch: str(d.branch) } : {}), ...(str(d.model) ? { model: str(d.model) } : {}),
    ...(files !== undefined ? { files } : {}),
  }
}

// The same run seen twice: tracked live in this session, and logged by run-log when it ended.
export const sameRun = (a: Delegation, b: Delegation): boolean =>
  a.tool === b.tool && a.cwd.replace(/\\/g, '/').toLowerCase() === b.cwd.replace(/\\/g, '/').toLowerCase()
  && (Math.abs(a.startedAt - b.startedAt) < 10 * 60_000 || Math.abs((a.endedAt ?? a.startedAt) - (b.endedAt ?? b.startedAt)) < 10 * 60_000)

const elapsedOf = (d: Delegation, at: number): number => Math.max(0, (d.endedAt ?? at) - d.startedAt)
const toolLabel = (d: Delegation): string => TOOLS[d.tool]?.name ?? d.tool

export function progressOf(d: Delegation, at: number): { ratio: number; kind: 'est' | 'done' | 'halted'; count: string } {
  const ms = elapsedOf(d, at)
  if (d.status === 'running') return { ratio: Math.min(0.95, ms / EST_MS), kind: 'est', count: `${fmtSpan(ms)} of ~${fmtSpan(EST_MS)}` }
  if (d.status === 'failed') return { ratio: Math.min(0.95, ms / EST_MS), kind: 'halted', count: `stopped at ${fmtTime(ms)}` }
  return { ratio: 1, kind: 'done', count: 'done' }
}

// The prompts the buttons put in the composer. Nothing here runs git.
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

// ---------------------------------------------------------------- tracking (the only code that touches $)
async function patch($: EngineInterface, id: string, change: Partial<Delegation>): Promise<void> {
  await update($, delegations, m => (m[id] ? { ...m, [id]: { ...m[id], ...change } } : m))
}

// The environment's home folder (see kit/paths.ts for the rules on each system).
async function homeEnv($: EngineInterface): Promise<HomeEnv> {
  const get = (v: Promise<string | undefined>) => v.catch(() => undefined)
  return { userProfile: await get($.env.get('USERPROFILE')), home: await get($.env.get('HOME')), configDir: await get($.env.get('CLAUDE_CONFIG_DIR')) }
}

async function readBrief($: EngineInterface, brief: string | undefined, cd: string, home: string): Promise<string> {
  if (!brief) return ''
  // "~/brief.md" means the home folder; nothing else would expand it.
  const path = expandHome(brief, home)
  for (const p of isAbs(path) ? [path] : [joinPath(cd, path), path]) {
    try {
      const t = await $.fs.read(p)
      if (typeof t === 'string' && t.trim()) return t
    } catch { /* not there yet */ }
  }
  return ''
}

async function gitBranch($: EngineInterface, id: string, cwd: string): Promise<void> {
  try {
    const r = await $.process.run(['git', '-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 8000 })
    const b = r.stdout.trim()
    if (r.exitCode === 0 && b && b !== 'HEAD') await patch($, id, { branch: b })
  } catch { /* no git here */ }
}

async function rootOf($: EngineInterface): Promise<string> {
  try { return await $.session.root() } catch { return '' }
}

async function record($: EngineInterface, command: unknown, toolUseId: unknown): Promise<void> {
  const call = parseRelay(command)
  if (!call) return
  const at = await $.clock.now()
  const root = await rootOf($)
  const id = str(toolUseId) || `d-${at}`
  if ((await read($, delegations))[id]) return
  const home = homeOf(await homeEnv($))
  const isWin = /^[A-Za-z]:/.test(root)
  // Git Bash spells C:\x as /c/x; on Windows turn it back. "~" is the home folder everywhere.
  const fix = (p: string): string => {
    const q = expandHome(p, home)
    return isWin ? q.replace(/^\/([A-Za-z])\//, '$1:/') : q
  }
  const cwd = fix(call.cd ?? root)
  const brief = (await readBrief($, call.brief ? fix(call.brief) : undefined, cwd, home)) || call.heredoc || ''
  const out = call.outDir ? fix(call.outDir) : undefined
  const resultPath = out ? joinPath(isAbs(out) ? out : joinPath(root, out), 'result.json') : undefined
  const d: Delegation = {
    id, tool: call.tool, task: taskOf(brief), ticket: ticketOf(brief, call.issue), project: baseName(cwd) || 'project', cwd,
    resultPath, startedAt: at, status: 'running', now: 'Starting', ...(call.model ? { model: call.model } : {}),
  }
  await update($, delegations, m => ({ ...m, [id]: d }))
  await update($, delegationOrder, l => (l.includes(id) ? l : [...l, id]))
  await gitBranch($, id, cwd)
}

// Without --out-dir the relay picks <tmp>/delegate-relay/<folder>-<time>; find the one for this run.
let tmpBase: string | undefined
const lastDiff = new Map<string, number>()

async function findResult($: EngineInterface, d: Delegation, claimed: Set<string>): Promise<string | undefined> {
  try {
    if (!tmpBase) {
      // Where Node's os.tmpdir() points, which is where the relays write by default.
      const get = (v: Promise<string | undefined>) => v.catch(() => undefined)
      const windows = isWindowsHome(homeOf(await homeEnv($)))
      tmpBase = tmpOf(windows, { tmpdir: await get($.env.get('TMPDIR')), temp: await get($.env.get('TEMP')), tmp: await get($.env.get('TMP')) })
    }
    if (!tmpBase) return undefined
    const dir = joinPath(tmpBase, 'delegate-relay')
    const names = (await $.fs.list(dir)).filter(x => x.kind === 'dir' && x.name.startsWith(`${baseName(d.cwd)}-`)).map(x => x.name).sort().reverse().slice(0, 6)
    for (const n of names) {
      const p = joinPath(joinPath(dir, n), 'result.json')
      if (claimed.has(p)) continue
      const st = await $.fs.stat(p).catch(() => undefined)
      if (st && st.mtimeMs >= d.startedAt - 2000) return p
    }
  } catch { /* nothing yet */ }
  return undefined
}

async function diffStats($: EngineInterface, d: Delegation, force: boolean): Promise<void> {
  const now = await $.clock.now()
  if (!force && now - (lastDiff.get(d.id) ?? 0) < DIFF_EVERY_MS) return
  lastDiff.set(d.id, now)
  try {
    const r = await $.process.run(['git', '-C', d.cwd, 'diff', '--shortstat'], { timeoutMs: 10000 })
    const s = r.exitCode === 0 ? parseShortstat(r.stdout) : undefined
    if (s) await patch($, d.id, { ...s, ...(d.status === 'running' ? { now: `Editing, ${s.files} ${s.files === 1 ? 'file' : 'files'} changed` } : {}) })
  } catch { /* silent */ }
}

async function check($: EngineInterface, d: Delegation, claimed: Set<string>): Promise<void> {
  const path = d.resultPath ?? (await findResult($, d, claimed))
  if (path) {
    const st = await $.fs.stat(path).catch(() => undefined)
    if (st && st.mtimeMs >= d.startedAt - 2000) {
      let raw: unknown
      try { raw = JSON.parse(String(await $.fs.read(path))) } catch { raw = undefined }
      if (raw !== undefined) {
        const change = applyResult(raw, await $.clock.now())
        if (d.task === DEFAULT_TASK && isObj(raw)) {
          const brief = await readBrief($, str(raw.briefPath), d.cwd)
          if (brief) Object.assign(change, { task: taskOf(brief), ticket: d.ticket?.startsWith('#') ? d.ticket : ticketOf(brief) })
        }
        await patch($, d.id, { ...change, resultPath: path })
        // The relay's touched-files count is replaced by real line counts when git has them.
        await diffStats($, { ...d, ...change, status: 'review' }, true)
        return
      }
    }
  }
  await diffStats($, d, false)
}

async function tick($: EngineInterface): Promise<void> {
  try {
    const all = await read($, delegations)
    const running = Object.values(all).filter(d => d.status === 'running')
    const claimed = new Set(Object.values(all).map(d => d.resultPath).filter((p): p is string => !!p))
    for (const d of running) {
      try { await check($, d, claimed) } catch { /* one bad run must not stop the rest */ }
    }
  } catch { /* the poll never throws */ }
}

// Today's finished runs from <repo>/.ops/runs/<ticket>/*.json.
async function loadOpsRuns($: EngineInterface): Promise<void> {
  try {
    const repo = await $.session.repo()
    if (!repo) return
    const base = joinPath(repo.root, '.ops/runs')
    const nowMs = await $.clock.now()
    const today = localDay(nowMs)
    const found: Delegation[] = []
    for (const dir of (await $.fs.list(base)).filter(x => x.kind === 'dir').slice(0, 60)) {
      for (const f of (await $.fs.list(joinPath(base, dir.name))).filter(x => x.kind === 'file' && x.name.endsWith('.json')).slice(0, 10)) {
        if (f.mtimeMs && localDay(f.mtimeMs) !== today) continue
        try {
          const raw: unknown = JSON.parse(String(await $.fs.read(joinPath(joinPath(base, dir.name), f.name))))
          const d = fromRun(raw, `run:${dir.name}/${f.name}`, baseName(repo.root), repo.root, /^[A-Z][A-Z0-9]*-\d+$/.test(dir.name) ? dir.name : '', f.mtimeMs || nowMs)
          if (d && localDay(d.endedAt ?? d.startedAt) === today) found.push(d)
        } catch { /* unreadable record */ }
      }
    }
    if (found.length === 0) return
    await update($, delegations, m => {
      const next = { ...m }
      for (const d of found) if (!next[d.id]) next[d.id] = d
      return next
    })
    await update($, delegationOrder, l => [...l, ...found.map(d => d.id).filter(id => !l.includes(id))])
  } catch { /* no .ops here */ }
}

// Today's runs that Mission Control's run-log.mjs logged, from any session, skipping the
// ones this session already follows.
async function loadRunLog($: EngineInterface): Promise<void> {
  try {
    const repo = await $.session.repo()
    if (!repo) return
    const src = await $.fs.read(joinPath(repo.root, '.ops/log/activity.jsonl')).catch(() => '')
    if (typeof src !== 'string' || !src.includes('"run-log"')) return
    const today = localDay(await $.clock.now())
    const titles = new Map(((await read($, board))?.tickets ?? []).map(t => [t.id, t.title] as const))
    const found: Delegation[] = []
    for (const line of src.split(/\r?\n/).slice(-400)) {
      if (!line.includes('"run-log"')) continue
      try {
        const d = fromRunLog(JSON.parse(line), titles)
        if (d && localDay(d.endedAt ?? d.startedAt) === today) found.push(d)
      } catch { /* a bad line */ }
    }
    if (found.length === 0) return
    const known = Object.values(await read($, delegations))
    const fresh = found.filter(d => !known.some(k => k.id === d.id || (!k.id.startsWith('log:') && sameRun(k, d))))
    if (fresh.length === 0) return
    await update($, delegations, m => ({ ...m, ...Object.fromEntries(fresh.map(d => [d.id, d] as const)) }))
    await update($, delegationOrder, l => [...l, ...fresh.map(d => d.id).filter(id => !l.includes(id))])
  } catch { /* no log here */ }
}

const RUN_LOG_MS = 30_000
let timer: { cancel: () => void } | undefined
let runLogTimer: { cancel: () => void } | undefined

export function registerDelegations(on: On): void {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    try { await record($, (e as { command?: unknown }).command, e.tool_use_id) } catch { /* observe only */ }
    return next(e)
  })
  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    try { await record($, (e as { command?: unknown }).command, e.tool_use_id) } catch { /* observe only */ }
    return next(e)
  })

  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    timer?.cancel()
    timer = $.clock.every(POLL_MS, () => void tick($))
    runLogTimer?.cancel()
    runLogTimer = $.clock.every(RUN_LOG_MS, () => void loadRunLog($))
    void loadOpsRuns($)
    void loadRunLog($)
    void tick($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'mission-control' }, async ($, e, next) => {
    const p = { ...DEFAULT_PANEL, ...(await read($, panel)) }
    const s = settingsOf(await read($, settings))
    if (activeTab(p.tab, s) !== 'delegations') return next(e)
    const ui = $.ui.resolve(e)
    const ctx = makeCtx(e, ui, await $.clock.now())
    const { Box } = ui
    const badges = badgesFrom(await read($, agents), await read($, delegations), await read($, board))
    return (
      <Box flexDirection="column" gap={1}>
        {tabBar(ui, 'delegations', badges, s, t => void update($, panel, q => ({ ...q, tab: t })), ctx.isDesktop ? ctx.W : 0, ctx.at)}
        {await renderTab($, ctx)}
      </Box>
    )
  }).catch(($, e, next) => paneFailed($, e, next.error, 'delegations'))
}

// ---------------------------------------------------------------- drawing
type Theme = 'follow' | 'light' | 'dark'

function headerSvg(W: number, run: number, rev: number, need: number, theme: Theme): string {
  const col = W / 3
  const fig = (i: number, name: string, n: number, cls: string) =>
    `${label(14 + i * col, 20, name)}${text(14 + i * col, 44, String(n), { size: 22, weight: 600, cls })}`
  return wide(W, 56, `${box(0, 0, W, 56)}${fig(0, 'Running', run, 't')}${fig(1, 'To review', rev, 't')}${fig(2, 'Needs you', need, need > 0 ? 'fl' : 't')}`, theme)
}

const CARD_H = 126

function cardSvg(W: number, d: Delegation, at: number, theme: Theme, motion: 'full' | 'calm' | 'off'): string {
  const t = TOOLS[d.tool] ?? { name: d.tool, color: '#888780' }
  const failed = d.status === 'failed', review = d.status === 'review', running = d.status === 'running'
  const pr = progressOf(d, at)
  const time = d.status === 'running' ? fmtSpan(elapsedOf(d, at)) : fmtTime(elapsedOf(d, at))
  const bw = textWidth(t.name, 10.5) + 14
  const tw = textWidth(time, 11)
  let b = failed || review ? box(0, 0, W, CARD_H, 'sf') + outline(0, 0, W, CARD_H, failed ? 'fail' : 'ok') : box(0, 0, W, CARD_H)
  // tool badge (Codex is ink, so it follows the theme)
  b += d.tool === 'codex'
    ? `<rect class="t" x="12" y="12" width="${bw}" height="18" rx="3"/>${text(19, 25, t.name, { size: 10.5, weight: 700, cls: 'sf' })}`
    : `<rect x="12" y="12" width="${bw}" height="18" rx="3" style="fill:${t.color}"/>${text(19, 25, t.name, { size: 10.5, weight: 700, fill: '#fff' })}`
  b += text(12 + bw + 8, 25, d.task, { size: 13, weight: 600, max: W - 24 - bw - 8 - tw - 12 })
  b += text(W - 12, 25, time, { size: 11, cls: 's', anchor: 'end' })
  // project · branch
  const prefix = `${d.ticket ? `${d.ticket} · ` : ''}${d.project}${d.branch ? ' · ' : ''}`
  b += text(12, 47, prefix, { size: 11.5, cls: 's', max: W - 24 })
  if (d.branch) {
    const bx = 12 + textWidth(prefix, 11.5) + 2
    b += iconInk('branch', bx, 36.5, 12, 'muted') + text(bx + 16, 47, d.branch, { size: 11.5, cls: 's', max: Math.max(40, W - bx - 28) })
  }
  // live action, progress
  b += iconInk(failed ? 'alert' : review ? 'check' : 'run', 12, 57, 14, failed ? 'fail' : review ? 'ok' : 'ink')
  b += text(32, 69, d.now, { size: 12.5, cls: failed ? 'fl' : 't', max: W - 44 })
  b += progress(12, 82, W - 24, pr.ratio, pr.kind, BAR, pr.count, running)
  // chips
  let x = 12
  if (d.files !== undefined) {
    const c = chip(x, 98, `${d.files} ${d.files === 1 ? 'file' : 'files'}`, 'plain', 'edit')
    b += c.svg
    x += c.w + 6
    if (d.added !== undefined) { b += text(x, 109.5, `+${d.added}`, { size: 10.5, cls: 'ok', weight: 600 }); x += textWidth(`+${d.added}`, 10.5) + 5 }
    if (d.removed !== undefined) { b += text(x, 109.5, `−${d.removed}`, { size: 10.5, cls: 'fl', weight: 600 }); x += textWidth(`−${d.removed}`, 10.5) + 8 }
  } else if (running) {
    const c = chip(x, 98, 'No changes yet', 'plain', 'edit')
    b += c.svg
    x += c.w + 6
  }
  if (!running) {
    const tests = d.tests
    const s = !tests?.ran ? (failed ? 'Tests not run' : 'Tests not reported') : tests.failed > 0 ? `Tests ${tests.failed} failed` : `Tests ${tests.passed} ✓`
    b += chip(x, 98, s, tests?.ran ? (tests.failed > 0 ? 'fail' : 'ok') : failed ? 'fail' : 'plain', 'shield').svg
  }
  const word = failed ? 'Needs you' : review ? 'Ready for review' : ''
  if (word) {
    const tone = failed ? 'fail' : 'ok'
    const w = statusWord(0, 0, word, tone, BAR).w
    b += statusWord(W - 12 - w, 97, word, tone, BAR).svg
  }
  return wide(W, CARD_H, b, theme, motion)
}

async function renderTab($: EngineInterface, ctx: TabCtx): Promise<RenderElement> {
  const { ui, isDesktop, W, at } = ctx
  const { Box, Text, Button } = ui
  const Svg = 'Svg' in ui ? ui.Svg : undefined
  const s = settingsOf(await read($, settings))
  const p = { ...DEFAULT_PANEL, ...(await read($, panel)) }
  const all = await read($, delegations)
  const order = await read($, delegationOrder)
  const ids = [...order.filter(id => all[id]), ...Object.keys(all).filter(id => !order.includes(id))]
  const list = ids.map(id => all[id]).filter((d): d is Delegation => d !== undefined)
  const today = localDay(at)
  const needs = list.filter(d => d.status === 'failed').reverse()
  const review = list.filter(d => d.status === 'review').reverse()
  const running = list.filter(d => d.status === 'running').reverse()
  const merged = list.filter(d => (d.status === 'merged' || d.status === 'done') && localDay(d.endedAt ?? d.startedAt) === today).reverse()
  const theme = s.look.theme, motion = s.look.motion
  const fill = (kind: Parameters<typeof promptFor>[0], d: Delegation) => () => void $.prompt.fill({ text: promptFor(kind, d), mode: 'replace' })
  const toggle = (key: string) => () => void update($, panel, q => ({ ...q, expanded: { ...q.expanded, [key]: !q.expanded[key] } }))

  if (needs.length + review.length + running.length + merged.length === 0) {
    return emptyState(ctx, s.look, 'delegations', 'Nothing delegated', 'Tasks you hand to Codex, agy, OpenCode or another Claude show here with their diff and test results.', 'builder', '#BA7517')
  }

  const buttons = (d: Delegation): RenderElement | null => {
    if (d.status === 'failed') {
      return (
        <Box key={`btn-${d.id}`} flexDirection="row" gap={1}>
          <Button key={`retry-${d.id}`} variant="primary" label="Retry" onPress={fill('retry', d)} />
          <Button key={`log-${d.id}`} label={p.expanded[`log-${d.id}`] ? 'Hide log' : 'Show log'} onPress={toggle(`log-${d.id}`)} />
          <Button key={`fix-${d.id}`} label="Fix it here" onPress={fill('fix', d)} />
        </Box>
      )
    }
    if (d.status === 'review') {
      return (
        <Box key={`btn-${d.id}`} flexDirection="row" gap={1}>
          <Button key={`review-${d.id}`} variant="primary" label="Review diff" onPress={fill('review', d)} />
          <Button key={`merge-${d.id}`} label="Merge" onPress={fill('merge', d)} />
          <Button key={`branch-${d.id}`} plain label="Open branch" onPress={fill('branch', d)} />
        </Box>
      )
    }
    return null
  }
  const logOf = (d: Delegation): RenderElement | null =>
    d.status === 'failed' && p.expanded[`log-${d.id}`]
      ? <Text key={`logtext-${d.id}`} wrap="wrap">{clip(d.error || d.finalMessage || 'No log was recorded.', 1200)}</Text>
      : null

  const mergedBlock = (
    <Box key="merged" flexDirection="column">
      {merged.length > 0 && <Button key="toggle-merged" plain label={`${p.expanded.merged ? '▾' : '▸'} Merged today · ${merged.length}`} onPress={toggle('merged')} />}
      {p.expanded.merged && merged.map(d => (
        <Text key={`m-${d.id}`} dimColor wrap="truncate-end">{`${toolLabel(d)} · ${d.task} · ${d.project}${d.ticket ? ` · ${d.ticket}` : ''} · ${fmtSpan(elapsedOf(d, at))}`}</Text>
      ))}
    </Box>
  )
  const live = [...needs, ...review, ...running]

  if (isDesktop && Svg) {
    return (
      <Box flexDirection="column" gap={1}>
        <Svg source={headerSvg(W, running.length, review.length, needs.length, theme)} alt={`${running.length} running, ${review.length} to review, ${needs.length} need you`} height={56} />
        {live.map(d => (
          <Box key={`card-${d.id}`} flexDirection="column" gap={1}>
            <Svg source={cardSvg(W, d, at, theme, motion)} alt={`${toolLabel(d)}: ${d.task}, ${d.project}, ${d.now}`} height={CARD_H} />
            {buttons(d)}
            {logOf(d)}
          </Box>
        ))}
        {mergedBlock}
      </Box>
    )
  }

  // Terminal and the rest: the same content as text.
  const barW = Math.max(6, Math.min(20, ctx.cols - 30))
  const row = (d: Delegation) => {
    const pr = progressOf(d, at)
    const glyph = d.status === 'failed' ? '✗' : d.status === 'review' ? '✓' : '●'
    const tone = d.status === 'failed' ? 'error' : d.status === 'review' ? 'success' : undefined
    const stat = d.files !== undefined ? `${d.files} files +${d.added ?? 0} −${d.removed ?? 0}` : 'no changes yet'
    const tests = d.tests?.ran ? (d.tests.failed > 0 ? `tests ${d.tests.failed} failed` : `tests ${d.tests.passed} ✓`) : 'tests not reported'
    return (
      <Box key={`card-${d.id}`} flexDirection="column" marginBottom={1}>
        <Text wrap="truncate-end"><Text color={tone}>{`${glyph} `}</Text><Text bold>{`${toolLabel(d)} · ${d.task}`}</Text><Text dimColor>{`  ${fmtSpan(elapsedOf(d, at))}`}</Text></Text>
        <Text dimColor wrap="truncate-end">{`   ${d.ticket ? `${d.ticket} · ` : ''}${d.project}${d.branch ? ` · ⎇ ${d.branch}` : ''}`}</Text>
        <Text wrap="truncate-end" color={d.status === 'failed' ? 'error' : undefined}>{`   ${d.now}`}</Text>
        <Text wrap="truncate-end">{'   '}{pr.kind === 'est' ? <Text dimColor>{estText(pr.ratio, barW)}</Text> : <Text color={pr.kind === 'done' ? 'success' : undefined} dimColor={pr.kind === 'halted'}>{barText(pr.ratio, barW)}</Text>}<Text>{`  ${pr.kind === 'est' ? '~' : ''}${Math.round(pr.ratio * 100)}%  `}</Text><Text dimColor>{pr.count}</Text></Text>
        <Text dimColor wrap="truncate-end">{`   ${stat} · ${tests}`}</Text>
        {buttons(d)}
        {logOf(d)}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Text bold>{`Running ${running.length} · To review ${review.length} · Needs you ${needs.length}`}</Text>
      <Box flexDirection="column" marginTop={1}>
        {live.map(row)}
        {mergedBlock}
      </Box>
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
