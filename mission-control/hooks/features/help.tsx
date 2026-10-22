// Help: the commands, what the bubbles and progress bars mean, and the keys. Static, so
// it is drawn from constants; the desktop draws the two pictures as one Svg each.
// Pattern: this file owns its hooks; its Pane hook draws only when its tab is active.
import { atom, read, update } from 'claude-code'
import { failedView } from '../kit/ui'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { AgentRecord, BoardSnapshot, CompanionSkill, Delegation, Settings } from '../../types'
import { activeTab, badgesFrom, tabBar } from '../kit/chrome'
import { barText, bubble, estText, hline, para, progress, svg, text, textWidth, wide } from '../kit/draw'
import { section } from '../kit/ui'
import type { ProgKind } from '../kit/draw'
import type { PaneInput } from '../kit/state'
import type { TabCtx, UiTable } from '../kit/state'
import { DEFAULT_PANEL, DEFAULT_SETTINGS, makeCtx, settingsOf } from '../kit/state'

const agents = atom({ plugin: 'mission-control', key: 'agents' } as const, {} as Record<string, AgentRecord>)
const board = atom({ plugin: 'mission-control', key: 'board' } as const, null as BoardSnapshot | null)
const delegations = atom({ plugin: 'mission-control', key: 'delegations' } as const, {} as Record<string, Delegation>)
const panel = atom({ plugin: 'mission-control', key: 'panel' } as const, DEFAULT_PANEL)
const settings = atom({ plugin: 'mission-control', key: 'settings' } as const, DEFAULT_SETTINGS)
const skills = atom({ plugin: 'mission-control', key: 'skills' } as const, null as CompanionSkill[] | null)

type BubbleKind = Parameters<typeof bubble>[2]

const COMMANDS: [string, string][] = [
  ['/mission', 'Open or close this panel'],
  ['/mission agents', 'Jump straight to a tab: agents, delegations, board, worktrees, log, settings, help, info'],
  ['/standup', 'Today across every project: done, doing, blocked, next'],
  ['/ship', 'PR description, changelog and a client update, after checks'],
  ['/budget 5h <percent>', 'When new agents pause: a share of the 5-hour or weekly window (week <percent>), or a daily dollar limit'],
  ['/handoff [note]', 'Write the note the next session starts from'],
]

// The skills that ship with the mod: what each does, how to start it, and the tab that follows it.
const WORKS_WITH: { name: string; what: string; run: string; tab: string }[] = [
  { name: 'ai-team-project-kickoff', what: 'Plans a project for a team of AI agents and writes the .ops/ layer: tickets, decisions, activity log', run: '/ai-team-project-kickoff, or “let’s plan this project”', tab: 'Board' },
  { name: 'codex-delegate', what: 'Hands a coding task to the Codex CLI; you review the diff', run: '/codex-delegate, or “have Codex do …”', tab: 'Delegations' },
  { name: 'agy-delegate', what: 'Hands a coding task to Google Antigravity (agy)', run: '/agy-delegate, or “have agy do …”', tab: 'Delegations' },
  { name: 'opencode-delegate', what: 'Hands a coding task to the OpenCode CLI', run: '/opencode-delegate, or “run it through OpenCode”', tab: 'Delegations' },
  { name: 'claude-delegate', what: 'Hands a coding task to a separate Claude Code process', run: '/claude-delegate, or “have another Claude implement this”', tab: 'Delegations' },
]
const STATE_WORD: Record<CompanionSkill['state'] | 'checking', { word: string; color: string }> = {
  yours: { word: 'Installed', color: '#3b9c5f' },
  mod: { word: 'Installed with Mission Control', color: '#3b9c5f' },
  missing: { word: 'Not installed', color: '#ba7517' },
  failed: { word: 'Could not install', color: '#d0453f' },
  checking: { word: 'Checking…', color: '#6b6b68' },
}
const stateOf = (list: CompanionSkill[] | null, name: string): keyof typeof STATE_WORD => list?.find(x => x.name === name)?.state ?? (list ? 'missing' : 'checking')

// One row per skill: the name and its state, what it does, then how to start it.
function worksSvg(W: number, list: CompanionSkill[] | null): { H: number; body: string } {
  let y = 0
  const body = WORKS_WITH.map((w, i) => {
    const st = STATE_WORD[stateOf(list, w.name)]
    const cw = textWidth(st.word, 10.5) + 14
    const what = para(0, y + 38, w.what, W, { size: 12, cls: 's', lh: 16 })
    const runY = y + 38 + what.h + 4
    const run = para(0, runY, `Run: ${w.run} · shows in ${w.tab}`, W, { size: 11.5, lh: 15 })
    const rowH = runY - y + run.h + 8
    const out = text(0, y + 18, w.name, { size: 12, weight: 700, mono: true, max: W - cw - 12 })
      + `<rect x="${W - cw}" y="${y + 6}" width="${cw}" height="17" rx="2" style="fill:${st.color};opacity:.16"/>`
      + text(W - cw + 7, y + 18, st.word, { size: 10.5, weight: 600, fill: st.color })
      + what.svg + run.svg + (i < WORKS_WITH.length - 1 ? hline(0, W, y + rowH - 1) : '')
    y += rowH
    return out
  }).join('')
  return { H: y, body }
}

const BUBBLES: [BubbleKind, string, string][] = [
  ['think', 'Thinking', '💭'],
  ['gear', 'Using a tool', '⚙️'],
  ['pen', 'Writing its report', '✍️'],
  ['alert', 'Needs you', '❗'],
  ['check', 'Done', '✅'],
  ['stop', 'Stopped', '⏹️'],
]

// The three progress examples: a real count, an estimate, and a halted run.
const PROGRESS: { ratio: number; kind: ProgKind; color: string; count: string; caption: string }[] = [
  { ratio: 0.6, kind: 'real', color: '#378ADD', count: '3/5', caption: 'Real: the agent reports its steps' },
  { ratio: 0.41, kind: 'est', color: '#378ADD', count: 'estimate', caption: 'Estimate: steps taken against what its role usually needs' },
  { ratio: 0.4, kind: 'halted', color: '#D0453F', count: '2/5', caption: 'Stopped where the red mark is' },
]

const KEYS: [string, string][] = [
  ['Tab', 'Move between controls'],
  ['1 – 4', 'Switch tabs while the panel has focus'],
  ['Esc', 'Back to the prompt'],
]

// A two-column table: the key in mono on the left, what it does wrapped on the right,
// a hairline under each row. Returns the markup and its height.
function tableSvg(W: number, rows: [string, string][], keyW: number): { H: number; body: string } {
  let y = 0
  const body = rows.map(([k, desc]) => {
    const p = para(keyW, y + 17, desc, W - keyW, { size: 12, cls: 's', lh: 16 })
    const rowH = Math.max(26, p.h + 10)
    const out = text(0, y + 17, k, { size: 11.5, weight: 600, mono: true, max: keyW - 8 }) + p.svg + hline(0, W, y + rowH - 1)
    y += rowH
    return out
  }).join('')
  return { H: y, body }
}

// The bubbles in a two-column legend, each in its own speech bubble.
function bubblesSvg(W: number, s: Settings): { H: number; svg: string } {
  const cell = W / 2
  const H = Math.ceil(BUBBLES.length / 2) * 26 + 6
  const body = BUBBLES.map(([kind, name], i) => {
    const x = (i % 2) * cell
    const y = Math.floor(i / 2) * 26 + 6
    return bubble(x, y, kind) + text(x + 30, y + 12, name, { size: 12, max: cell - 36 })
  }).join('')
  return { H, svg: wide(W, H, body, s.look.theme, s.look.motion) }
}

// The three progress examples, one under the other, each with its caption.
function progressSvg(W: number, s: Settings): { H: number; svg: string } {
  const body = PROGRESS.map((p, i) => {
    const y = i * 40 + 8
    return progress(0, y, W, p.ratio, p.kind, p.color, p.count) + text(0, y + 21, p.caption, { size: 11, cls: 's', max: W })
  }).join('')
  const H = PROGRESS.length * 40 + 2
  return { H, svg: wide(W, H, body, s.look.theme, s.look.motion) }
}

// The terminal has no Svg: the same two pictures as text lines.
function terminalBubbles(ui: UiTable): RenderElement {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      {BUBBLES.map(([kind, name, emoji]) => <Text key={`bub-${kind}`}>{`${emoji}  ${name}`}</Text>)}
    </Box>
  )
}

function terminalProgress(ui: UiTable): RenderElement {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" gap={1}>
      {PROGRESS.map(p => (
        <Box key={`prog-${p.kind}`} flexDirection="column">
          <Text>{`${p.kind === 'est' ? estText(p.ratio, 24) : barText(p.ratio, 24)}  ${p.kind === 'est' ? '~' : ''}${Math.round(p.ratio * 100)}%  ${p.count}`}</Text>
          <Text dimColor>{p.caption}</Text>
        </Box>
      ))}
    </Box>
  )
}

// The terminal has no Svg: a table as bold keys with their meaning.
function terminalTable(ui: UiTable, key: string, rows: [string, string][]): RenderElement {
  const { Box, Text } = ui
  return (
    <Box key={`tt-${key}`} flexDirection="column">
      {rows.map(([k, desc]) => (
        <Box key={`${key}-${k}`} flexDirection="row" gap={2} flexWrap="wrap">
          <Text bold>{k}</Text>
          <Text dimColor>{desc}</Text>
        </Box>
      ))}
    </Box>
  )
}

// ---------------------------------------------------------------- the tab
function renderHelp(ctx: TabCtx, s: Settings, companions: CompanionSkill[] | null): RenderElement {
  const { ui, isDesktop, W } = ctx
  const { Box, Text } = ui
  const Svg = 'Svg' in ui ? ui.Svg : undefined
  const look = s.look
  const keyW = Math.min(150, Math.round(W * 0.36))
  const table = (key: string, rows: [string, string][]) => {
    if (!isDesktop || !Svg) return terminalTable(ui, key, rows)
    const t = tableSvg(W, rows, keyW)
    return <Svg key={`tbl-${key}`} source={wide(W, t.H, t.body, look.theme, look.motion)} alt={rows.map(([k, d]) => `${k}: ${d}`).join('; ')} height={t.H} />
  }
  const works = worksSvg(W, companions)
  const bub = bubblesSvg(W, s)
  const prog = progressSvg(W, s)
  return (
    <Box flexDirection="column">
      {section(ctx, look, 'cmds', 'Commands', 'Type them in the prompt.', true)}
      {table('cmds', COMMANDS)}

      {section(ctx, look, 'works', 'Works with', 'Skills that ship with Mission Control. Missing ones are copied to ~/.claude/skills when a session starts (Settings › Panel turns this off); copies you made are never touched.')}
      {isDesktop && Svg
        ? <Svg key="works" source={wide(W, works.H, works.body, look.theme, look.motion)} alt={WORKS_WITH.map(w => `${w.name}: ${STATE_WORD[stateOf(companions, w.name)].word}. ${w.what}. Run: ${w.run}`).join('; ')} height={works.H} />
        : (
          <Box key="works-t" flexDirection="column" gap={1}>
            {WORKS_WITH.map(w => (
              <Box key={`w-${w.name}`} flexDirection="column">
                <Text bold>{`${w.name}  ·  ${STATE_WORD[stateOf(companions, w.name)].word}`}</Text>
                <Text dimColor>{w.what}</Text>
                <Text>{`Run: ${w.run} · shows in ${w.tab}`}</Text>
              </Box>
            ))}
          </Box>
        )}

      {section(ctx, look, 'bubbles', 'What the bubbles mean', 'The small bubble over each crab in Your Team.')}
      {isDesktop && Svg ? <Svg source={bub.svg} alt={BUBBLES.map(([, name]) => name).join(', ')} height={bub.H} /> : terminalBubbles(ui)}

      {section(ctx, look, 'bars', 'Progress bars')}
      {isDesktop && Svg ? <Svg source={prog.svg} alt={PROGRESS.map(p => `${p.kind === 'est' ? '~' : ''}${Math.round(p.ratio * 100)}% ${p.count}: ${p.caption}`).join('; ')} height={prog.H} /> : terminalProgress(ui)}

      {section(ctx, look, 'keys', 'Keys', 'While the panel has focus.')}
      {table('keys', KEYS)}
    </Box>
  )
}

export function registerHelp(on: On): void {
  on('ui.render', { component: 'Pane', requestId: 'mission-control' }, async ($, e, next) => {
    const p = { ...DEFAULT_PANEL, ...(await read($, panel)) }
    const s = settingsOf(await read($, settings))
    if (activeTab(p.tab, s) !== 'help') return next(e)
    const ui = $.ui.resolve(e)
    const c = makeCtx(e, ui, await $.clock.now())
    const { Box } = ui
    const badges = badgesFrom(await read($, agents), await read($, delegations), await read($, board))
    return (
      <Box flexDirection="column" gap={1}>
        {tabBar(ui, 'help', badges, s, t => void update($, panel, q => ({ ...q, tab: t })), c.isDesktop ? c.W : 0, c.at)}
        {renderHelp(c, s, await read($, skills))}
      </Box>
    )
  }).catch(($, e, next) => paneFailed($, e, next.error, 'help'))
}

// When drawing fails, say so in the pane (and keep the reason for a bug report) instead of
// leaving it blank.
async function paneFailed($: EngineInterface, e: PaneInput, error: unknown, where: string): Promise<RenderElement> {
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : JSON.stringify(error)
  await $.store.set('lastError', { where, reason, at: await $.clock.now() }).catch(() => undefined)
  return failedView($.ui.resolve(e), where, reason)
}
