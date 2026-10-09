import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { fallbackDraft, makeDoc, openPrPrompt, parseDraft, parseFrontmatter, ticketOf } from '../hooks/features/ship'
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
