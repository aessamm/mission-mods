import { expect, mock, test } from 'claude-code/testing'

import { addEntry, byProject, emptyDay, firstLine, parseSections, plainSections } from '../hooks/features/log'

const PANE = {
  component: 'Pane' as const,
  requestId: 'mission-control',
  props: { title: 'Mission Control', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const START = { cwd: '/work/demo', surface: null, isInteractive: true }
const SPAWN = { tool_use_id: 'tu', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: true, fork: false }
const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('day log totals and per-project blocks follow the entries', () => {
  let d = emptyDay('2026-10-09')
  d = addEntry(d, { at: 1, project: 'A', kind: 'session', text: 'Session started' })
  d = addEntry(d, { at: 2, project: 'A', kind: 'agent', text: 'Found it', costUsd: 0.5 })
  d = addEntry(d, { at: 3, project: 'B', kind: 'agent', text: 'Fixed', costUsd: 0.25 })
  expect([d.sessions, d.agents, d.spentUsd]).toEqual([1, 2, 0.75])
  const a = byProject(d).find(p => p.project === 'A')!
  expect([a.sessions, a.agents, a.lines]).toEqual([1, 1, ['Found it']])
  expect(firstLine('\n## Done the thing\nmore')).toBe('Done the thing')
})

test('standup text parses into sections and falls back to a plain list', () => {
  const s = parseSections('**Done**\n- A: shipped\nDoing:\n- B: wip\n\n## Next\n* C')
  expect(s.map(x => x.heading)).toEqual(['Done', 'Doing', 'Next'])
  const plain = plainSections({ day: addEntry(emptyDay('d'), { at: 1, project: 'A', kind: 'agent', text: 'x' }), board: null })
  expect(plain.map(x => x.heading)).toEqual(['Done', 'Doing', 'Blocked', 'Next'])
  expect(plain[0]!.lines[0]).toBe('A: x')
  const board = { root: '/w/app', project: 'app', activity: [], readAt: 0, tickets: [
    { id: '#42', title: 'Paste the secret', status: 'waiting' as const, path: 'u' },
    { id: '#35', title: 'Backup', status: 'in_progress' as const, path: 'u' },
  ] }
  const gh = plainSections({ day: emptyDay('d'), board })
  expect(gh[1]!.lines).toEqual(['app: #35 Backup'])
  expect(gh[2]!.lines).toEqual(['app: #42 Paste the secret (waiting on owner)'])
})

test('the Log tab, /standup and /handoff work from a session and a finished agent', async ($, on) => {
  mock.clock(on)
  on('session.start', () => ({ cwd: START.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  on('turn.complete', () => ({ text: '' }))
  on('session.repo', () => ({ value: null }))
  const kv = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: kv.get(e.key) }))
  on('store.set', (_$, e) => { kv.set(e.key, e.value); return { value: undefined as never } })
  on('session.cwd', () => ({ value: '/work/demo' }))
  on('fs.exists', () => ({ value: false }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('model.complete', () => ({ value: { isAnswered: false as const, reason: 'api-error' as const, status: 500, usage: USAGE } as never }))
  await $.session.start(START)
  await $.agent.spawn({ ...SPAWN, prompt: 'map it', description: 'Map the store', subagentType: 'Explore' })
  await $.turn.complete({ agentId: 'a1', reason: 'answer', answer: 'Mapped the session store\nmore', durationMs: 10, isAborted: false, turnId: 't1', usage: { ...USAGE, input_tokens: 1000, output_tokens: 1000, model: 'claude-sonnet-5-5' } as never })
  const standup = await $.command.run({ command: 'standup', args: '' })
  expect(standup.text?.includes('demo: ')).toBe(true)
  expect(standup.text?.includes('Mapped the session store')).toBe(true)
  const h = await $.command.run({ command: 'handoff', args: 'Stopped after the map.' })
  expect(h.text?.includes('Handoff saved for demo')).toBe(true)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-log' })
    const drawn = JSON.stringify(await ui.drawn())
    for (const s of ['Generate standup', 'Mapped the session store', 'Stopped after the map', 'Last handoff']) expect(drawn.includes(s)).toBe(true)
    await ui.unmount()
  }
})
