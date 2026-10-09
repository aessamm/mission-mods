// Layout pieces every tab shares, pure (no $): section headings, settings rows with their
// controls on the right, a segmented control, and the empty-state card. Handlers are
// closures the caller builds with $ in its own file.
import type { RenderElement } from 'claude-code'

import type { Settings } from '../../types'
import { emptyCard, fline, fsvg, hline, rowLabel, sectionHead, svg, wide } from './draw'
import type { TabCtx } from './state'

type Look = Pick<Settings['look'], 'theme' | 'motion'>

// The uppercase heading that opens a section; from the second section on, a hairline above it.
export function section(c: TabCtx, look: Look, key: string, title: string, hint?: string, isFirst = false): RenderElement {
  const { Text, Box } = c.ui
  const Svg = 'Svg' in c.ui ? c.ui.Svg : undefined
  if (c.isDesktop && Svg) {
    const head = sectionHead(c.W, title, hint, isFirst)
    // Full width: the hairline above runs to the pane's edge.
    const body = isFirst ? head.svg : fline(4) + head.svg.replace(/^<line[^>]*\/>/, '')
    return <Svg key={`sec-${key}`} source={fsvg(head.H, body, look.theme, look.motion)} alt={hint ? `${title}. ${hint}` : title} height={head.H} />
  }
  return (
    <Box key={`sec-${key}`} flexDirection="column" marginTop={isFirst ? 0 : 1}>
      <Text bold dimColor>{title.toUpperCase()}</Text>
      {hint ? <Text dimColor>{hint}</Text> : null}
    </Box>
  )
}

// A hairline across the pane, between rows of a section; its own tiny drawing, since
// a pane holds dozens of them.
const rule = (W: number, theme: Look['theme']) => {
  const line = (c: string) => `line{stroke:${c}}`
  const css = theme === 'dark' ? line('#333331') : theme === 'light' ? line('#e4e4e1') : `${line('#e4e4e1')}@media (prefers-color-scheme: dark){${line('#333331')}}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="1" viewBox="0 0 ${W} 1"><style>${css}</style><line x1="0" y1=".5" x2="${W}" y2=".5"/></svg>`
}

// A hairline across the pane, between rows of a section.
export function divider(c: TabCtx, look: Look, key: string): RenderElement | null {
  const Svg = 'Svg' in c.ui ? c.ui.Svg : undefined
  if (!c.isDesktop || !Svg) return null
  return <Svg key={`div-${key}`} source={fsvg(1, fline(0), look.theme, 'off')} alt="" height={1} />
}

// One settings row: name and hint on the left, controls pushed to the right, hairline under.
// ctrlW is the room the controls take, in px, so the label knows where to stop.
export function row(c: TabCtx, look: Look, key: string, name: string, hint: string | undefined, ctrlW: number, controls: RenderElement | RenderElement[]): RenderElement {
  const { Box, Text } = c.ui
  const Svg = 'Svg' in c.ui ? c.ui.Svg : undefined
  if (c.isDesktop && Svg) {
    // Narrow pane: the controls move under the label, on a line of their own, so an input
    // and its button are never squeezed or cut off.
    if (c.W - ctrlW < 200) {
      const label = rowLabel(c.W, name, hint)
      return (
        <Box key={`row-${key}`} flexDirection="column">
          <Svg source={wide(c.W, label.H, label.svg, look.theme, look.motion)} alt={hint ? `${name}. ${hint}` : name} height={label.H} />
          <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap" marginTop={1} marginBottom={1}>{controls}</Box>
          {divider(c, look, key)}
        </Box>
      )
    }
    const w = Math.max(120, c.W - ctrlW - 12)
    const label = rowLabel(w, name, hint)
    return (
      <Box key={`row-${key}`} flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Svg source={svg(w, label.H, label.svg, look.theme, look.motion)} alt={hint ? `${name}. ${hint}` : name} width={w} height={label.H} />
          <Box flexDirection="row" gap={1} alignItems="center">{controls}</Box>
        </Box>
        {divider(c, look, key)}
      </Box>
    )
  }
  return (
    <Box key={`row-${key}`} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" gap={1} flexWrap="wrap">
        <Text bold>{name}</Text>
        <Box flexDirection="row" gap={1}>{controls}</Box>
      </Box>
      {hint ? <Text dimColor>{hint}</Text> : null}
    </Box>
  )
}

// A segmented control: one button per choice, the chosen one drawn as the primary button.
export function segmented(c: TabCtx, key: string, opts: readonly (readonly [string, string])[], cur: string, onPick: (v: string) => void): RenderElement[] {
  const { Button } = c.ui
  return opts.map(([v, label]) => (
    <Button key={`${key}-${v}`} label={v === cur ? `✓ ${label}` : label} variant={v === cur ? 'primary' : undefined} dimColor={v === cur ? undefined : true} onPress={() => { if (v !== cur) onPick(v) }} />
  ))
}

// An on and off switch, as a two-choice segmented control so its state reads at a glance.
export function onOff(c: TabCtx, key: string, isOn: boolean, onSet: (v: boolean) => void): RenderElement[] {
  return segmented(c, key, [['on', 'On'], ['off', 'Off']], isOn ? 'on' : 'off', v => onSet(v === 'on'))
}

// What a tab shows with nothing in it, and an optional next step under the card.
export function emptyState(c: TabCtx, look: Look, key: string, title: string, body: string, role: string, color: string, action?: RenderElement): RenderElement {
  const { Box, Text } = c.ui
  const Svg = 'Svg' in c.ui ? c.ui.Svg : undefined
  if (c.isDesktop && Svg) {
    const card = emptyCard(c.W, title, body, role, color, look.motion !== 'off')
    return (
      <Box key={`empty-${key}`} flexDirection="column" gap={1} alignItems="center">
        <Svg source={wide(c.W, card.H, card.svg, look.theme, look.motion)} alt={`${title}. ${body}`} height={card.H} />
        {action ?? null}
      </Box>
    )
  }
  return (
    <Box key={`empty-${key}`} flexDirection="column" alignItems="center" marginTop={1}>
      <Text>🦀</Text>
      <Text bold>{title}</Text>
      <Text dimColor wrap="wrap">{body}</Text>
      {action ?? null}
    </Box>
  )
}

// What a tab shows when it could not draw: where, and why, so it can be reported.
export function failedView(ui: TabCtx['ui'], where: string, reason: string): RenderElement {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="error">{`Mission Control could not draw the ${where} tab`}</Text>
      <Text wrap="wrap">{reason.slice(0, 600)}</Text>
      <Text dimColor>Send a screenshot of this to Claude.</Text>
    </Box>
  )
}
