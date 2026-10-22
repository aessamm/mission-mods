import { expect, mock, test } from 'claude-code/testing'

import { requestFor, stateOf } from '../hooks/features/info'
import { parseDollars, setRoute } from '../hooks/features/settings'
import { DEFAULT_SETTINGS, nameOf } from '../hooks/kit/state'
import { UI } from './helpers'

const PANE = {
  component: 'Pane' as const,
  requestId: 'mission-control',
  props: { title: 'Mission Control', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

const shows = async (ui: { drawn: () => Promise<unknown> }, text: string) => JSON.stringify(await ui.drawn()).includes(text)

// Tab buttons are keyed tab-<id>; a press on a tab that is already the active one finds no button,
// so the press does nothing.
const goTo = (ui: { press: (t: { key: string }) => Promise<unknown> }, key: string) => ui.press({ key }).catch(() => undefined)

test('the typed dollar limit and the route rows parse and clear as expected', async () => {
  expect(parseDollars('$8')).toBe(8)
  expect(parseDollars(' 12,000.5 ')).toBe(12000.5)
  expect(parseDollars('0')).toBe(undefined)
  expect(parseDollars('lots')).toBe(undefined)
  const routed = setRoute(DEFAULT_SETTINGS, 'scout', 'model', 'claude-haiku-5-5')
  expect(routed.routing.byRole.scout?.model).toBe('claude-haiku-5-5')
  expect(setRoute(routed, 'scout', 'model', 'default').routing.byRole.scout?.model).toBe(undefined)
})

test('the settings sections draw on both surfaces, and a show toggle saves to the store', UI, async ($, on) => {
  mock.clock(on)
  // The test engine has no store of its own: answer the store events from a map.
  const stored = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_$, e) => { stored.set(e.key, e.value); return { value: undefined as never } })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await goTo(ui, 'tab-settings')
    expect(await shows(ui, 'Daily limit')).toBe(true)
    expect(await shows(ui, 'Route models automatically')).toBe(true)
    expect(await shows(ui, 'AGENTS AND MODELS')).toBe(true)
    expect(await shows(ui, '✓ On')).toBe(true)
    expect(await shows(ui, '<svg')).toBe(surface === 'desktop')
    await ui.press({ key: 'show-agents-off' })
    const saved = stored.get('settings') as { show: { agents: boolean } }
    expect(saved.show.agents).toBe(false)
    await ui.press({ key: 'show-agents-on' })
    expect((stored.get('settings') as { show: { agents: boolean } }).show.agents).toBe(true)
    await ui.unmount()
  }
})

test('help and info draw their static content on both surfaces', UI, async ($, on) => {
  mock.clock(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await goTo(ui, 'tab-help')
    expect(await shows(ui, '/mission agents')).toBe(true)
    expect(await shows(ui, 'COMMANDS')).toBe(true)
    expect(await shows(ui, 'PROGRESS BARS')).toBe(true)
    await goTo(ui, 'tab-info')
    expect(await shows(ui, 'part of Mission Mods')).toBe(true)
    expect(await shows(ui, '0.6.1')).toBe(false)
    expect(await shows(ui, 'THE MISSION MODS FAMILY')).toBe(true)
    expect(await shows(ui, 'Mission Mods on GitHub')).toBe(true)
    expect(await shows(ui, 'Check for updates')).toBe(true)
    await ui.unmount()
  }
})

test('a family member reads as on, off, available or coming soon, and its button asks for the right command', () => {
  const installed = new Set(['guardrails@mission-mods'])
  expect(stateOf('guardrails', installed, {}, new Set())).toBe('on')
  expect(stateOf('guardrails', installed, { 'guardrails@mission-mods': false }, new Set())).toBe('off')
  expect(stateOf('brain', installed, {}, new Set(['brain']))).toBe('available')
  expect(stateOf('brain', installed, {}, new Set())).toBe('soon')
  expect(requestFor('install', 'brain', 'Brain')).toContain('claude plugin install brain@mission-mods --scope user')
  expect(requestFor('remove', 'guardrails', 'Guardrails')).toContain('claude plugin uninstall guardrails@mission-mods')
})

test('agent names follow Settings: Tester Alpha, Tester 1, or the person\'s own names in turn', () => {
  const a = { role: 'Tester', callsign: 'Tester Alpha', nth: 0 }
  const b = { ...a, callsign: 'Tester Bravo', nth: 1 }
  const c = { ...a, callsign: 'Tester Charlie', nth: 2 }
  const own = { ...DEFAULT_SETTINGS, look: { ...DEFAULT_SETTINGS.look, names: 'custom' as const }, agentNames: { tester: 'Omar, Sara', main: 'Claude' } }
  expect(nameOf(b, DEFAULT_SETTINGS)).toBe('Tester Bravo')
  expect(nameOf(b, { ...DEFAULT_SETTINGS, look: { ...DEFAULT_SETTINGS.look, names: 'numbers' } })).toBe('Tester 2')
  expect(nameOf(a, own)).toBe('Omar - (Tester)')
  expect(nameOf(b, own)).toBe('Sara - (Tester)')
  expect(nameOf(c, own)).toBe('Omar 2 - (Tester)')
  expect(nameOf({ role: 'Builder', callsign: 'Builder Alpha', nth: 0 }, own)).toBe('Builder Alpha')
  expect(nameOf({ role: 'Lead', callsign: 'Claude · Main', isMain: true }, own)).toBe('Claude - (Main)')
  expect(nameOf({ ...a, callsign: 'Tester “Ziad”', isNamed: true }, own)).toBe('Tester “Ziad”')
})
