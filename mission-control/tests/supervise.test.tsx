import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { githubRepoOf, setupBoardPrompt } from '../hooks/features/board'
import { superviseText } from '../hooks/features/supervise'
import { UI } from './helpers'

const PANE = {
  component: 'Pane' as const,
  requestId: 'mission-control',
  props: { title: 'Mission Control', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const START = { cwd: '/repo', surface: null, isInteractive: true }

// Starts a session in a repo with this remote and no board; answers what the composer got.
async function start($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], remote: string | null): Promise<string[]> {
  mock.clock(on)
  const filled: string[] = []
  on('session.start', () => ({ cwd: START.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  on('session.repo', () => ({ value: { root: '/repo', remote, internal: false } }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ deny: 'ENOENT' }))
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true } })
  await $.session.start(START)
  return filled
}

test('the supervise text, the GitHub repo of a remote and the setup request', () => {
  expect(superviseText('')).toBe('/board-supervisor')
  expect(superviseText('  check the board ')).toBe('/board-supervisor check the board')
  expect(githubRepoOf('https://github.com/aessamm/mission-mods.git')).toBe('aessamm/mission-mods')
  expect(githubRepoOf('git@github.com:aessamm/mos.git')).toBe('aessamm/mos')
  expect(githubRepoOf('https://github.com/aessamm/my.repo/')).toBe('aessamm/my.repo')
  expect(githubRepoOf('https://gitlab.com/aessamm/mos.git')).toBeNull()
  expect(githubRepoOf(null)).toBeNull()
  const p = setupBoardPrompt('aessamm/mos')
  expect(p.startsWith('/board-supervisor ')).toBe(true)
  expect(p).toContain('GitHub Issues and a project board for aessamm/mos')
})

test('/supervise fills the composer with /board-supervisor and the text given', UI, async ($, on) => {
  const filled = await start($, on, null)
  const r = await $.command.run({ command: 'supervise', args: 'plan the week' })
  expect(filled).toEqual(['/board-supervisor plan the week'])
  expect(JSON.stringify(r)).toContain('The composer has /board-supervisor plan the week')
  await $.command.run({ command: 'supervise', args: '' })
  expect(filled.at(-1)).toBe('/board-supervisor')
})

test('an empty Board in a GitHub repo offers Set up a board, on both surfaces', UI, async ($, on) => {
  const filled = await start($, on, 'https://github.com/aessamm/mos.git')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-board' })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.includes('No board in this project')).toBe(true)
    expect(drawn.includes('"setup-board"')).toBe(true)
    expect(drawn.includes('"kickoff"')).toBe(false)
    await ui.press({ key: 'setup-board' })
    expect(filled.at(-1)).toBe(setupBoardPrompt('aessamm/mos'))
    await ui.unmount()
  }
})

test('an empty Board off GitHub keeps the kickoff button, on both surfaces', UI, async ($, on) => {
  const filled = await start($, on, 'https://gitlab.com/someone/app.git')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-board' })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.includes('"kickoff"')).toBe(true)
    expect(drawn.includes('"setup-board"')).toBe(false)
    await ui.press({ key: 'kickoff' })
    expect(filled.at(-1)).toBe('/ai-team-project-kickoff')
    await ui.unmount()
  }
})

test('Help lists board-supervisor among the skills and /supervise among the commands, on both surfaces', UI, async ($, on) => {
  await start($, on, null)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-help' })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.includes('board-supervisor')).toBe(true)
    expect(drawn.includes('/supervise [text]')).toBe(true)
    expect(drawn.includes('Runs the project from GitHub Issues')).toBe(true)
    expect(drawn.includes('Run: /supervise, /board-supervisor')).toBe(true)
    await ui.unmount()
  }
})
