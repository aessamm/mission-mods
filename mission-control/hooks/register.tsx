// Mission Control. Each feature file owns its hooks and draws its own tab; this file
// loads the settings, opens the pane, answers /mission, and registers the features.
import { atom, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Settings, TabId } from '../types'
import { DEFAULT_PANEL, DEFAULT_SETTINGS, PANE, STORE, TITLE } from './kit/state'
import { registerAgents } from './features/agents'
import { registerBoard } from './features/board'
import { registerDelegations } from './features/delegations'
import { registerHelp } from './features/help'
import { registerInbox } from './features/inbox'
import { registerInfo } from './features/info'
import { registerLog } from './features/log'
import { registerSettings } from './features/settings'
import { registerShip } from './features/ship'
import { registerSkills } from './features/skills'
import { registerStatusLine } from './features/statusline'

const panel = atom({ plugin: 'mission-control', key: 'panel' } as const, DEFAULT_PANEL)
const settings = atom({ plugin: 'mission-control', key: 'settings' } as const, DEFAULT_SETTINGS)

const TABS: TabId[] = ['agents', 'delegations', 'board', 'log', 'settings', 'help', 'info']

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Settings persist across sessions; merge over defaults so new fields get values.
    // Loaded before the rest of session start, so nothing beneath can keep them out.
    const saved = (await $.store.get(STORE.settings).catch(() => undefined)) as Partial<Settings> | undefined
    if (saved) {
      await update($, settings, () => ({
        ...DEFAULT_SETTINGS, ...saved,
        show: { ...DEFAULT_SETTINGS.show, ...saved.show },
        budget: { ...DEFAULT_SETTINGS.budget, ...saved.budget },
        routing: { ...DEFAULT_SETTINGS.routing, ...saved.routing },
        look: { ...DEFAULT_SETTINGS.look, ...saved.look },
      }))
    }
    const started = await next(e)
    await $.command.register({
      name: 'mission',
      description: 'Open Mission Control; add a tab (agents, delegations, board, log, settings, help, info) to jump to it',
      argumentHint: '[tab]',
    })
    $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    return started
  })

  on('command.run', { command: 'mission' }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase() as TabId
    const isTab = TABS.includes(arg)
    if (isTab) await update($, panel, p => ({ ...p, tab: arg, isCompact: false }))
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: isTab ? `Mission Control: ${arg}.` : 'Mission Control is open.' }
  })

  registerAgents(on)
  registerDelegations(on)
  registerBoard(on)
  registerLog(on)
  registerSettings(on)
  registerHelp(on)
  registerInfo(on)
  registerInbox(on) // before the status line, so its rows wrap the status line's band
  registerStatusLine(on)
  registerShip(on)
  registerSkills(on)
}
