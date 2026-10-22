import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { budgetState, cacheHit, fmtReset, parseGit } from '../hooks/features/statusline'
import { UI } from './helpers'

const BAND = (bodyColumns: number) => ({
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
})

test('git status, cache hit, resets and budget states parse and format', async () => {
  const git = parseGit('# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -0\n1 .M N... 100644 100644 100644 a b src/x.ts\n? new.txt\n')
  expect(git?.branch).toBe('main')
  expect(git?.changed).toBe(2)
  expect(git?.ahead).toBe(2)
  expect(git?.behind).toBe(0)
  expect(parseGit('')).toBe(null)
  expect(cacheHit({ input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 })).toBe(90)
  expect(cacheHit({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(0)
  expect(fmtReset(78 * 60000)).toBe('1h 18m')
  expect(fmtReset(3 * 86400000 + 4 * 3600000)).toBe('3d 4h')
  expect(budgetState(4.2, 5, 0.8)).toBe('warn')
  expect(budgetState(5, 5, 0.8)).toBe('fail')
  expect(budgetState(1, 5, 0.8)).toBe('ok')
})

// pct: the 5-hour window's use; null means an API-key account with no plan windows.
async function setup($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], usd: number, pct: number | null = 62) {
  mock.clock(on)
  on('session.usage', () => ({ value: {
    startedAt: 0, context: { window: 1_000_000, percent: 41, tokens: 410_000 }, cost: { usd },
    rateLimits: pct === null ? [] : [{ kind: 'five_hour', percentUsed: pct, resetsAt: new Date(3_600_000).toISOString() }],
  } }))
  const kept = new Map<string, unknown>()
  on('store.get', e => ({ value: kept.get((e as unknown as { key: string }).key) }))
  on('store.set', e => { kept.set((e as unknown as { key: string }).key, (e as unknown as { value: unknown }).value); return { value: undefined } })
  on('session.turns', () => ({ value: 38 }))
  on('session.id', () => ({ value: 'test-session' }))
  on('session.cwd', () => ({ value: 'C:/work/mission-control' }))
  on('ui.render', { component: 'AbovePrompt' }, () => null as never)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '' }))
  // A finished main-loop turn makes the plugin total the day's spend.
  await $.turn.complete({ reason: 'answer', answer: '', durationMs: 14000, isAborted: false, turnId: 't1', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 } })
  await new Promise(r => setTimeout(r, 50))
}

test('the desktop draws the status line, wide and narrow', UI, async ($, on) => {
  await setup($, on, 6, 95)
  for (const cols of [120, 80]) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'desktop', ...BAND(cols) })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('Context')
    expect(drawn).toContain('5-hour')
    // On a plan, a window past its pause point joins as a third line with a Hide button.
    expect(drawn).toContain('5-hour limit 95% used')
    await ui.unmount()
  }
})

test('on a plan, a full 5-hour window pauses new agents and /budget 5h raises the pause point', UI, async ($, on) => {
  await setup($, on, 6, 95)
  const spawn = { tool_use_id: 'tu', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: true, fork: false, prompt: 'p', description: 'd', subagentType: 'Explore' }
  expect(String((await $.agent.spawn(spawn)).deny)).toContain('5-hour limit is 95% used')
  expect(JSON.stringify(await $.command.run({ command: 'budget', args: '5h 98' } as never))).toContain('98%')
  expect((await $.agent.spawn(spawn)).deny).toBeUndefined()
})

test('without plan windows, a spent dollar budget denies a new agent and /budget raises the limit', UI, async ($, on) => {
  await setup($, on, 6, null)
  const spawn = { tool_use_id: 'tu', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'claude-opus-5-5', background: true, fork: false, prompt: 'p', description: 'd', subagentType: 'Explore' }
  const denied = await $.agent.spawn(spawn)
  expect(String(denied.deny)).toContain('Daily budget reached')
  const r = await $.command.run({ command: 'budget', args: '50' } as never)
  expect(JSON.stringify(r)).toContain('$50')
})
