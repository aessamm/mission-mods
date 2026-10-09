import { expect, mock, test } from 'claude-code/testing'

import { blockedBy, idsIn, milestonesOf, parseDecisions, parseTicket, statsOf } from '../hooks/features/board'

const PANE = {
  component: 'Pane' as const,
  requestId: 'mission-control',
  props: { title: 'Mission Control', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const START = { cwd: '/repo', surface: null, isInteractive: true }
const file = (name: string) => ({ name, kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false })
const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
const ticket = (id: string, status: string, extra = '') => `---\nid: ${id}\ntitle: ${id} title\nstatus: ${status}\nmilestone: ${id.split('-')[0]}\n${extra}---\n`

const DECISIONS = `# Decisions log
\`\`\`
## D-001 — <short decision title> (YYYY-MM-DD)
\`\`\`
## D-001 — First milestone is a thin slice (2026-09-20)
## D-002 — Codex implements, Claude reviews (2026-09-21)
## D-003 — Free models rotate on rate limit (2026-09-22)
## D-004 — Dashboard is the first helper ticket (2026-09-23)
`

test('dependencies, decisions, run stats and milestones read the kickoff files', () => {
  expect(idsIn('[M0-003, M0-004]')).toEqual(['M0-003', 'M0-004'])
  const a = parseTicket(ticket('M0-003', 'done'), 'a.md')!
  const b = parseTicket(ticket('M0-004', 'in_progress'), 'b.md')!
  const c = parseTicket(ticket('M1-001', 'todo', 'depends_on: [M0-003, M0-004]\nmodel: gpt-x / high\n'), 'c.md')!
  expect(c).toMatchObject({ dependsOn: ['M0-003', 'M0-004'], model: 'gpt-x / high' })
  expect(blockedBy(c, new Map([a, b, c].map(t => [t.id, t] as const)))).toEqual(['M0-004'])
  expect(milestonesOf([a, b, c])).toEqual([{ name: 'M0', done: 1, total: 2 }, { name: 'M1', done: 0, total: 1 }])
  // The format example in the fence is skipped; the newest three come first.
  expect(parseDecisions(DECISIONS).map(d => d.id)).toEqual(['D-004', 'D-003', 'D-002'])
  expect(parseDecisions(DECISIONS)[0]).toMatchObject({ title: 'Dashboard is the first helper ticket', date: '2026-09-23' })
  const s = statsOf([
    { agent: 'codex', reviewVerdict: 'approved', durationSec: 300, reworkCount: 0 },
    { agent: 'codex', reviewVerdict: 'rejected', durationSec: 500, reworkCount: 2 },
    { agent: 'agy', reviewVerdict: 'approved_with_fixes', rateLimited: true },
  ])
  expect(s[0]).toMatchObject({ agent: 'codex', runs: 2, approved: 1, rejected: 1, reworks: 2, avgSec: 400 })
  expect(s[1]).toMatchObject({ agent: 'agy', runs: 1, approved: 1, rateLimited: 1 })
})

test('the board shows what a ticket is blocked by, the agents and the latest decisions', async ($, on) => {
  mock.clock(on)
  on('session.start', () => ({ cwd: START.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false } }))
  on('fs.exists', () => ({ value: true }))
  on('fs.list', (_$, e) => ({
    value: e.path.endsWith('tickets') ? [file('M0-003.md'), file('M0-004.md')]
      : /\.ops[\\/]runs$/.test(e.path) ? [dir('M0-003')]
        : /runs[\\/]M0-003$/.test(e.path) ? [file('codex-1.json')] : [],
  }))
  on('fs.read', (_$, e) => ({
    value: e.path.endsWith('M0-003.md') ? ticket('M0-003', 'in_progress')
      : e.path.endsWith('M0-004.md') ? ticket('M0-004', 'todo', 'depends_on: [M0-003]\n')
        : e.path.endsWith('DECISIONS.md') ? DECISIONS
          : e.path.endsWith('codex-1.json') ? '{"agent":"codex","status":"completed","reviewVerdict":"approved","durationSec":240}' : '',
  }))
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-board' })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.includes('Blocked by M0-003')).toBe(true)
    expect(drawn.includes('Latest decisions')).toBe(true)
    expect(drawn.includes('D-004')).toBe(true)
    expect(drawn.includes('100% approved')).toBe(true)
    await ui.unmount()
  }
})

test('missing companion skills are copied in, yours are left alone, and Help says which is which', async ($, on) => {
  mock.clock(on)
  on('session.start', () => ({ cwd: START.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  mock.env(on, { HOME: '/home/u' })
  const writes: string[] = []
  const norm = (p: string) => p.replace(/\\/g, '/')
  on('fs.write', (_$, e) => { writes.push(norm(e.path).replace(/^.*\/\.claude\//, '~/.claude/')); return { value: undefined } })
  on('fs.exists', (_$, e) => ({ value: norm(e.path).endsWith('/.claude/skills/agy-delegate/SKILL.md') }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_$, e) => {
    if (norm(e.path).endsWith('bundled-skills/manifest.json')) return { value: JSON.stringify({ 'codex-delegate': { files: ['SKILL.md', 'scripts/relay.mjs'], hash: 'h1' }, 'agy-delegate': { files: ['SKILL.md'], hash: 'h2' } }) }
    if (norm(e.path).includes('bundled-skills/')) return { value: 'content' }
    throw new Error('missing')
  })
  await $.session.start(START)
  for (let i = 0; i < 40 && writes.length < 3; i++) await new Promise(r => setTimeout(r, 25))
  await new Promise(r => setTimeout(r, 100))
  expect(writes).toEqual([
    '~/.claude/skills/codex-delegate/SKILL.md',
    '~/.claude/skills/codex-delegate/scripts/relay.mjs',
    '~/.claude/skills/codex-delegate/.mission-control.json',
  ])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-help' })
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.toLowerCase().includes('works with')).toBe(true)
    expect(drawn.includes('Installed with Mission Control')).toBe(true)
    expect(drawn.includes('ai-team-project-kickoff')).toBe(true)
    await ui.unmount()
  }
})
