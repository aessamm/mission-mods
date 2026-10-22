import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { parseChangelog, releaseOf, updateToast } from '../hooks/kit/changelog'

const PANE = {
  component: 'Pane' as const,
  requestId: 'mission-control',
  props: { title: 'Mission Control', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

const CHANGELOG = [
  '# Changelog',
  '',
  '## mission-control 0.12.0 — what changed, in the mod',
  '',
  '- Info: **What\'s new** and the earlier releases, read from the mod\'s own',
  '  `CHANGELOG.md` (#14).',
  '- A toast after an update.',
  '',
  '## mission-control 0.11.0 — act from the board',
  '',
  '- Board: **Start** and **Open** (#1).',
  '',
  '## Another heading',
  '- not a release bullet',
  '',
  '## mission-control 0.9.0',
  '* first public release',
].join('\r\n')

test('the changelog parses into releases with their bullets, newest first', () => {
  const list = parseChangelog(`\uFEFF${CHANGELOG}`)
  expect(list.map(r => r.version)).toEqual(['0.12.0', '0.11.0', '0.9.0'])
  expect(list[0]).toEqual({
    version: '0.12.0', title: 'what changed, in the mod',
    bullets: ['Info: **What\'s new** and the earlier releases, read from the mod\'s own `CHANGELOG.md` (#14).', 'A toast after an update.'],
  })
  expect(list[1]!.bullets).toEqual(['Board: **Start** and **Open** (#1).'])
  expect(list[2]).toEqual({ version: '0.9.0', title: '', bullets: ['first public release'] })
  expect(parseChangelog('no releases here')).toEqual([])
  expect(releaseOf(list, '0.11.0')?.title).toBe('act from the board')
  expect(releaseOf(list, '9.9.9')?.version).toBe('0.12.0')
})

test('the update toast shows only when a different version was seen before', () => {
  expect(updateToast(undefined, '0.12.0')).toBeUndefined()
  expect(updateToast('0.12.0', '0.12.0')).toBeUndefined()
  expect(updateToast('0.11.0', '')).toBeUndefined()
  expect(updateToast('0.11.0', '0.12.0')).toBe('Mission Control updated to 0.12.0. What\'s new: /mission info')
})

// The test host resolves the plugin's root against its own drive, so mocks match on the tail.
async function startInfo($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], seen: string | undefined) {
  mock.clock(on)
  const stored = new Map<string, unknown>(seen ? [['seenVersion', seen]] : [])
  const toasts: string[] = []
  on('store.get', (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_$, e) => { stored.set(e.key, e.value); return { value: undefined as never } })
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined as never } })
  on('session.start', () => ({ cwd: '/w/app' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  on('session.repo', () => ({ value: { root: '/w/app', remote: null, internal: false } }))
  on('session.cwd', () => ({ value: '/w/app' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_$, e) => {
    const p = e.path.replace(/\\/g, '/')
    return p.endsWith('/.claude-plugin/plugin.json') ? { value: '{"name":"mission-control","version":"0.12.0"}' }
      : p.endsWith('/CHANGELOG.md') ? { value: CHANGELOG } : { deny: 'ENOENT' }
  })
  await $.session.start({ cwd: '/w/app', surface: null, isInteractive: true })
  return { stored, toasts }
}

test('Info shows the version, What\'s new and a collapsed changelog; Help shows the version, on both surfaces', async ($, on) => {
  const { stored, toasts } = await startInfo($, on, undefined)
  expect(toasts).toEqual([])                        // a first install stays quiet
  expect(stored.get('seenVersion')).toBe('0.12.0')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-info' })
    let drawn = JSON.stringify(await ui.drawn())
    expect(drawn.includes('Version 0.12.0 · part of Mission Mods')).toBe(true)
    expect(drawn.includes('0.12.0')).toBe(true)
    expect(drawn.includes('A toast after an update.')).toBe(true)
    expect(drawn.includes('0.11.0 · act from the board')).toBe(true)
    expect(drawn.includes('Board: **Start**')).toBe(false)
    await ui.press({ key: 'cl-0.11.0' })
    drawn = JSON.stringify(await ui.drawn())
    expect(drawn.includes('Board: **Start** and **Open** (#1).')).toBe(true)
    await ui.press({ key: 'cl-0.11.0' })
    await ui.press({ key: 'tab-help' })
    expect(JSON.stringify(await ui.drawn()).includes('Mission Control v0.12.0')).toBe(true)
    await ui.unmount()
  }
})

test('after an update, one toast names the new version', async ($, on) => {
  const { stored, toasts } = await startInfo($, on, '0.11.0')
  expect(toasts).toEqual(['Mission Control updated to 0.12.0. What\'s new: /mission info'])
  expect(stored.get('seenVersion')).toBe('0.12.0')
})
