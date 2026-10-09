import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { mainRecord, titleFor } from '../hooks/features/agents'

const PANE = {
  component: 'Pane' as const,
  requestId: 'mission-control',
  props: { title: 'Mission Control', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const SPAWN = { tool_use_id: 'tu', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: true, fork: false }

async function squad($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  mock.clock(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `a${++n}` }))
  on('turn.complete', () => ({ text: '' }))
  await $.agent.spawn({ ...SPAWN, prompt: 'Find where sessions are stored', description: 'Locate session store', subagentType: 'Explore' })
  await $.agent.spawn({ ...SPAWN, prompt: 'Fix the login bug', description: 'Fix login bugs', subagentType: 'general-purpose' })
  await $.turn.complete({ agentId: 'a2', reason: 'error', answer: '', durationMs: 10, isAborted: false, turnId: 't2' })
}

test('the Agents tab shows the agent that needs you first, then the running ones', async ($, on) => {
  await squad($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.includes('Scout Alpha')).toBe(true)
    expect(drawn.includes('Debugger Alpha')).toBe(true)
    expect(drawn.includes('Retry') || drawn.includes('needs you')).toBe(true)
    await ui.unmount()
  }
})

test('the Agents tab is always expanded and shows the team, with no Collapse button', async ($, on) => {
  await squad($, on)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'desktop', ...PANE })
  expect(JSON.stringify(await ui.drawn()).includes('YOUR TEAM')).toBe(true)
  expect(await ui.find({ key: 'collapse' }).catch(() => undefined)).toBeUndefined()
  await ui.unmount()
})

test('details open per agent with its mission', async ($, on) => {
  await squad($, on)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE })
  await ui.press({ key: 'more-a1' })
  expect(JSON.stringify(await ui.drawn()).includes('Find where sessions are stored')).toBe(true)
  await ui.unmount()
})

test('the main agent sits first in the list, even alone, and goes back to waiting after an answer', async ($, on) => {
  mock.clock(on)
  on('turn.complete', () => ({ text: '' }))

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await ($ as unknown as { session: { start: (e: unknown) => Promise<unknown> } }).session.start({ isInteractive: true, source: 'startup', cwd: '/work/demo' })
  expect(mainRecord(0, 'x').isMain).toBe(true)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.includes('Claude · Main')).toBe(true)
    expect(drawn.includes('No sub-agents yet')).toBe(true)
    expect(drawn.includes('No agents yet')).toBe(false)
    await ui.unmount()
  }
  await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 10, isAborted: false, turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE })
  expect(JSON.stringify(await ui.drawn()).includes('Waiting for you')).toBe(true)
  expect(await ui.find({ key: 'stop-main' }).catch(() => undefined)).toBeUndefined()
  await ui.unmount()
})

test('the panel title shows the state: working turns, needs you warns, quiet shows a crab', () => {
  const base = mainRecord(0, 'claude-opus-5-5')
  expect(titleFor([{ ...base, status: 'idle' }])).toBe('🛰️ Mission Control')
  expect(titleFor([{ ...base, status: 'thinking' }])).toBe('● Mission Control · 1 working')
  expect(titleFor([{ ...base, status: 'failed' }])).toBe('⚠ Mission Control · 1 needs you')
})
