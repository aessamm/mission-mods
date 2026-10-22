// Pane chrome shared by every tab: the tab bar and the badges, pure (no $).
import type { RenderElement } from 'claude-code'
import { fmtSpan } from './role'

import type { AgentRecord, BoardSnapshot, Delegation, Settings, TabId } from '../../types'
import type { UiTable } from './state'
import { box, css, fline, right, text } from './draw'

export type TabBadge = { count?: number; attention?: boolean }
export type Badges = Partial<Record<TabId, TabBadge>> & { live?: number; needs?: number; since?: number }
const MAIN: [TabId, string][] = [['agents', 'Agents'], ['delegations', 'Delegations'], ['board', 'Board'], ['worktrees', 'Worktrees'], ['log', 'Log']]
const SIDE: [TabId, string, string][] = [['settings', '⚙', 'Settings'], ['help', '?', 'Help'], ['info', 'ⓘ', 'Info']]

// Tabs owned by a feature file other than agents.tsx; agents.tsx draws everything else.
export const FEATURE_TABS: TabId[] = ['delegations', 'board', 'worktrees', 'log', 'settings', 'help', 'info']

export function badgesFrom(agents: Record<string, AgentRecord>, delegations: Record<string, Delegation>, board: BoardSnapshot | null): Badges {
  const a = Object.values(agents)
  const d = Object.values(delegations)
  const live = a.filter(x => x.status === 'starting' || x.status === 'thinking' || x.status === 'writing' || x.status === 'tool')
  return {
    live: live.length,
    needs: a.filter(x => x.status === 'failed').length,
    since: live.length ? Math.min(...live.map(x => x.startedAt)) : undefined,
    agents: { count: a.length || undefined, attention: a.some(x => x.status === 'failed') },
    delegations: { count: d.filter(x => x.status !== 'merged').length || undefined, attention: d.some(x => x.status === 'failed' || x.status === 'review') },
    board: { count: board?.tickets.filter(t => t.status !== 'done').length || undefined, attention: !!board?.tickets.some(t => t.status === 'blocked') },
  }
}

// Which tab to draw: a hidden tab falls back to Agents.
export function activeTab(tab: TabId, s: Settings): TabId {
  const shown = s.show as unknown as Record<string, boolean>
  return shown[tab] === false ? 'agents' : tab
}

// ---------------------------------------------------------------- the header
// The panel's own header above the tabs: a radar that tells the state at a glance, the
// name, and a word for the state. Quiet: a slow green sweep. Working: a fast blue sweep
// with a blip, and how long the oldest running agent has been at it. Needs you: a red
// pulse on a red-tinted header. Motion follows Settings › Motion and reduced motion.
const RADAR_CSS = `<style>
.rd-slow{transform-origin:15px 22px;animation:rd-spin 4s linear infinite}
.rd-fast{transform-origin:15px 22px;animation:rd-spin 1.2s linear infinite}
.rd-blip{animation:rd-blink 1.2s steps(1) infinite}
.rd-pulse{transform-origin:15px 22px;animation:rd-pulse 1.2s ease-out infinite}
@keyframes rd-spin{to{transform:rotate(360deg)}}
@keyframes rd-blink{50%{opacity:0}}
@keyframes rd-pulse{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.25);opacity:0}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style>`
export function headerSvg(W: number, b: Badges, s: Settings, at: number): { svg: string; alt: string } {
  const needs = b.needs ?? 0, live = b.live ?? 0
  const state = needs ? 'needs' : live ? 'working' : 'quiet'
  const word = needs ? `${needs} need${needs > 1 ? '' : 's'} you` : live ? `${live} working` : 'All quiet'
  const ring = (r: number, cls: string) => `<circle cx="15" cy="22" r="${r}" fill="none" class="${cls}" stroke-width="1.7"/>`
  const sweep = (color: string, cls: string) => `<g class="${cls}"><path d="M15 22 L15 13" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/></g>`
  const icon = state === 'needs'
    ? `<g class="rd-pulse">${ring(9, 'st-fl')}</g><circle cx="15" cy="22" r="4" class="fl"/>`
    : ring(9, 'st-m') + ring(5, 'rim') + (state === 'working'
      ? sweep('#378add', 'rd-fast') + `<circle cx="19" cy="18" r="1.4" fill="#378add" class="rd-blip"/>`
      : sweep('#3b9c5f', 'rd-slow'))
  const ground = state === 'needs' ? `<rect class="ft" x="0" y="2" width="100%" height="40" rx="10"/>` : ''
  const tile = box(0, 7, 30, 30, state === 'needs' ? 'sf' : 'tile', 8)
  const body = ground + tile + icon
    + text(40, 27, 'Mission Control', { size: 14, weight: 700 })
    + text(40 + 122, 27, word, { size: 12, cls: state === 'needs' ? 'fl' : 's', weight: state === 'needs' ? 600 : undefined })
    + (state === 'working' && b.since ? right(text(-4, 27, fmtSpan(at - b.since), { size: 11.5, cls: 's', anchor: 'end' })) : '')
    + (state === 'needs' ? '' : fline(43))
  const motion = s.look.motion
  const svgSrc = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="44">${css(s.look.theme, motion, false)}${motion === 'off' ? '' : RADAR_CSS}${body}</svg>`
  return { svg: svgSrc, alt: `Mission Control, ${word}` }
}

// Four working tabs on the left; Settings, Help and Info as single glyphs pushed to the far
// right. Every tab is the same kind of button, so padding and hover match; the active tab
// is the primary one; a tab with something that needs you carries
// a dot. W is the drawing width (desktop) for the hairline under the bar; onGo is a closure
// the caller builds with $ in its own file.
export function tabBar(ui: UiTable, active: TabId, badges: Badges, s: Settings, onGo: (t: TabId) => void, W = 0, at = Date.now()): RenderElement {
  const { Box, Button } = ui
  const Svg = 'Svg' in ui ? ui.Svg : undefined
  const shown = s.show as unknown as Record<string, boolean>
  const main = MAIN.filter(([id]) => shown[id] !== false)
  const head = W > 0 && Svg ? headerSvg(W, badges, s, at) : null
  return (
    <Box key="tabbar" flexDirection="column">
      {head && Svg ? <Svg key="mc-header" source={head.svg} alt={head.alt} height={44} /> : null}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Box flexDirection="row" gap={1} flexWrap="wrap" flexGrow={1}>
          {main.map(([id, name], i) => {
            const b = badges[id] ?? {}
            const label = `${name}${b.count ? ` ${b.count}` : ''}${b.attention && id !== active ? ' •' : ''}`
            return <Button key={`tab-${id}`} label={label} hotkey={String(i + 1)} variant={id === active ? 'primary' : undefined} dimColor={id === active ? undefined : true} onPress={() => onGo(id)} />
          })}
        </Box>
        <Box flexDirection="row" gap={1} flexShrink={0}>
          {SIDE.map(([id, glyph]) => (
            <Button key={`tab-${id}`} label={glyph} variant={id === active ? 'primary' : undefined} dimColor={id === active ? undefined : true} onPress={() => onGo(id)} />
          ))}
        </Box>
      </Box>
      {W > 0 && Svg ? <Svg source={rule()} alt="" height={6} /> : null}
    </Box>
  )
}

// The hairline under the tab bar, in both themes.
const rule = () => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="6"><style>line{stroke:#e4e4e1}@media (prefers-color-scheme: dark){line{stroke:#333331}}</style><line x1="0" y1="3.5" x2="100%" y2="3.5"/></svg>`

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
