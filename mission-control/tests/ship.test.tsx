import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { buildPrompt, docMarkdown, fallbackDraft, issuesOf, makeDoc, openPrPrompt, parseDraft, parseFrontmatter, ticketOf } from '../hooks/features/ship'
import type { ShipFacts } from '../hooks/features/ship'

const FACTS: ShipFacts = {
  branch: 'feat/tabs',
  base: 'main',
  commits: ['abc1234 Add tabs', 'def5678 Fix budget band'],
  commitCount: 2,
  shortstat: '3 files changed, 40 insertions(+)',
  done: [{ id: 'MC-1', title: 'Tabs' }],
  review: [{ id: 'MC-2', title: 'Budget' }],
}

test('with a GitHub board, the release is the issues its commits name', () => {
  const tickets = [
    { id: '#28', title: 'Mission Control reads GitHub', status: 'in_review' as const, path: 'u' },
    { id: '#35', title: 'Daily DB backup', status: 'in_progress' as const, path: 'u' },
  ]
  const commits = ['3f5437c ci: Actions CI, daily DB backup check (#34, #35)', 'aa11bb2 feat(github): issues view (#28)', 'cc33dd4 fix: color #fff in the header', 'ee55ff6 chore: tidy (#35)']
  const issues = issuesOf(commits, tickets)
  expect(issues).toEqual([
    { id: '#34', title: 'ci: Actions CI, daily DB backup check (#34, #35)' },
    { id: '#35', title: 'Daily DB backup', status: 'in_progress' },
    { id: '#28', title: 'Mission Control reads GitHub', status: 'in_review' },
  ])
  const facts: ShipFacts = { ...FACTS, commits, commitCount: 4, done: [], review: [], issues }
  const d = fallbackDraft(facts)
  expect(d.pr.includes('## Issues\n- #34: ci: Actions CI')).toBe(true)
  expect(d.pr.includes('- #35: Daily DB backup (in progress)')).toBe(true)
  expect(d.pr.includes('Tickets closed')).toBe(false)
  const doc = makeDoc(facts, d, 1)
  expect([doc.extra?.issues, doc.extra?.open]).toEqual(['3', '1'])
  const md = docMarkdown(doc)
  expect(md.includes('- 3 GitHub issues named in the commits')).toBe(true)
  expect(md.includes('- Warning: 1 issue not yet in Review or Done on the board')).toBe(true)
  expect(buildPrompt(facts).includes('GitHub issues the commits refer to, with their board column (3):')).toBe(true)
  expect(buildPrompt(FACTS).includes('Tickets closed (1):')).toBe(true)
})

test('frontmatter, tickets and model JSON parse defensively', async () => {
  expect(parseFrontmatter('---\nid: MC-1\ntitle: "Tabs: panel"\nstatus: done\n---\nbody: x')).toEqual({ id: 'MC-1', title: 'Tabs: panel', status: 'done' })
  expect(parseFrontmatter('no frontmatter')).toEqual({})
  expect(ticketOf('MC-9.md', '---\nstatus: in-review\n---\n')).toEqual({ status: 'in_review', ticket: { id: 'MC-9', title: 'MC-9' } })
  const good = '```json\n{"title":"T","pr":"p","changelog":"- c","clientAr":"ا","clientEn":"e"}\n```'
  expect(parseDraft(good)?.title).toBe('T')
  expect(parseDraft('{"title":"T"}')).toBeUndefined()
  expect(parseDraft('sorry')).toBeUndefined()
})

test('the fallback draft and the doc carry commits, tickets and view state', async () => {
  const d = fallbackDraft(FACTS)
  expect(d.changelog).toBe('- Add tabs\n- Fix budget band')
  expect(d.pr.includes('MC-1: Tabs')).toBe(true)
  const doc = makeDoc(FACTS, d, 1)
  expect(doc.kind).toBe('ship')
  expect(doc.sections.length).toBe(4)
  expect(doc.extra?.review).toBe('1')
  expect(openPrPrompt(doc).startsWith('Open a pull request from feat/tabs to main with this description:')).toBe(true)
})

async function ship($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  mock.clock(on)
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false } }))
  on('process.run', (_$, e) => {
    const a = e.argv.join(' ')
    const out = a.includes('rev-parse --abbrev-ref') ? 'feat/tabs' : a.includes('--oneline') ? 'abc1234 Add tabs\ndef5678 Fix budget band' : a.includes('rev-list') ? '2' : a.includes('shortstat') ? '3 files changed' : 'ok'
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.list', (_$, e) => ({ value: e.path.endsWith('tickets') ? [{ name: 'MC-1.md', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }, { name: 'MC-2.md', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] : [] }))
  on('fs.read', (_$, e) => ({ value: e.path.endsWith('MC-1.md') ? '---\nid: MC-1\ntitle: Tabs\nstatus: done\n---\n' : '---\nid: MC-2\ntitle: Budget\nstatus: in_review\n---\n' }))
  on('model.complete', () => ({ value: { isAnswered: true as const, text: 'not json', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  return $.command.run({ command: 'ship', args: '' })
}

test('/ship falls back to a deterministic draft when the model reply is not JSON', async ($, on) => {
  const r = await ship($, on)
  expect(r.text?.includes('MC-1: Tabs')).toBe(true)
  expect(r.text?.includes('1 ticket still in review')).toBe(true)
  expect(r.text?.includes('Tests: not run by Mission Control')).toBe(true)
})

test('the /ship card draws on both surfaces and switches to the Arabic client update', async ($, on) => {
  await ship($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, component: 'CommandOutput', props: { command: 'ship', args: '', text: 'x', isErrored: false } })
    const drawn = async () => JSON.stringify(await ui.drawn())
    expect((await drawn()).includes('Copy all')).toBe(true)
    expect((await drawn()).includes('Open PR')).toBe(true)
    await ui.press({ key: 'view-client' })
    expect((await drawn()).includes('العربية')).toBe(true)
    await ui.unmount()
  }
})
