import { expect, mock, test } from 'claude-code/testing'

import { treeLine } from '../hooks/features/worktrees'
import { ago, issueOf, landPrompt, parseLog, parseStatus, parseWorktreeList, removePrompt, sessionPrompt, shortPath, syncOf } from '../hooks/kit/worktrees'
import { UI } from './helpers'

const PANE = {
  component: 'Pane' as const,
  requestId: 'mission-control',
  props: { title: 'Mission Control', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const START = { cwd: '/repo/.claude/worktrees/wt-7', surface: null, isInteractive: true }
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0)

const LIST = [
  'worktree /repo', 'HEAD aaaaaaa1', 'branch refs/heads/main', '',
  'worktree /repo/.claude/worktrees/wt-7', 'HEAD bbbbbbb2', 'branch refs/heads/claude/worktrees-7-17f58a', '',
  'worktree /repo/.claude/worktrees/wt-5', 'HEAD ccccccc3', 'branch refs/heads/feat/issue-5-board', 'locked', '',
  'worktree /repo/.claude/worktrees/gone', 'HEAD ddddddd4', 'detached', 'prunable gitdir file points to non-existent location', '',
].join('\n')

test('worktree list, status and log parse; branch names give the issue only when explicit', () => {
  const list = parseWorktreeList(LIST.replace(/\n/g, '\r\n'))
  expect(list.map(w => w.branch ?? '-')).toEqual(['main', 'claude/worktrees-7-17f58a', 'feat/issue-5-board', '-'])
  expect(list[2]).toMatchObject({ isLocked: true, isPrunable: false })
  expect(list[3]).toMatchObject({ isDetached: true, isPrunable: true })

  expect(parseStatus('# branch.oid x\n# branch.head feat\n# branch.upstream origin/feat\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b f.ts\n? new.ts\n'))
    .toEqual({ changes: 2, upstream: 'origin/feat', ahead: 2, behind: 1 })
  expect(parseStatus('# branch.oid x\n# branch.head feat\n')).toEqual({ changes: 0 })

  expect(parseLog('abc1234\t1761134400\tfeat: tabs (#7)\n\n')).toEqual([{ sha: 'abc1234', at: 1761134400000, subject: 'feat: tabs (#7)' }])

  expect(issueOf('feat/issue-5-board', [])).toBe('#5')
  expect(issueOf('fix/gh-12', [])).toBe('#12')
  // A counter in a worktree name is not an issue; the branch's own commits are asked instead.
  expect(issueOf('claude/worktrees-7-17f58a', [])).toBe(undefined)
  expect(issueOf('claude/worktrees-7-17f58a', ['wip no-issue', 'feat(x): y (#7)'])).toBe('#7')
})

test('short paths, ages, push state and the composer lines read as the person expects', () => {
  expect(shortPath('C:\\repo\\.claude\\worktrees\\wt-7', false)).toBe('wt-7')
  expect(shortPath('/repo', true)).toBe('repo (main)')
  expect(ago(NOW - 30_000, NOW)).toBe('now')
  expect(ago(NOW - 5 * 3600_000, NOW)).toBe('5h')
  expect(ago(NOW - 3 * 86400_000, NOW)).toBe('3d')
  expect(syncOf({ branch: 'x' })).toBe('not pushed')
  expect(syncOf({ branch: 'x', upstream: 'origin/x', ahead: 2, behind: 0 })).toBe('↑2')
  expect(syncOf({ branch: 'x', upstream: 'origin/x', ahead: 0, behind: 0 })).toBe('in sync')
  expect(syncOf({})).toBe('detached')
  const w = { path: '/repo/wt-7', branch: 'claude/wt-7', issue: '#7' }
  expect(landPrompt(w, 'main')).toContain('Review and land the branch claude/wt-7 in the worktree /repo/wt-7 (#7)')
  expect(removePrompt(w)).toContain('Check it is clean first')
  expect(sessionPrompt(w)).toBe('Start a new session in the worktree /repo/wt-7 on the branch claude/wt-7 to carry on with #7.')
  expect(treeLine({ path: '/r', name: 'r (main)', branch: 'main', isMain: true, isCurrent: false, isLocked: false, isPrunable: false, sha: 'abc', subject: 'x', committedAt: NOW - 3600_000, changes: 0, upstream: 'origin/main', ahead: 0, behind: 0 }, NOW))
    .toBe('r (main) · main · abc · x · 1h · clean · in sync')
})

test('the Worktrees tab reads git once, draws every worktree on both surfaces, and its buttons fill the composer', UI, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.start', () => ({ cwd: START.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined as never }))
  on('session.repo', () => ({ value: { root: '/repo', remote: null, internal: false } }))
  on('session.cwd', () => ({ value: START.cwd }))
  const calls: string[] = []
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_$, e) => {
    const a = e.argv.join(' '), cwd = String(e.init?.cwd ?? '')
    calls.push(a)
    if (a.includes('worktree list')) return ok(LIST)
    if (a.includes('status')) return ok(cwd.endsWith('wt-7') ? '# branch.head x\n? a.ts\n? b.ts\n' : '# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n')
    if (a.includes('main..HEAD')) return ok(cwd.endsWith('wt-7') ? 'b2\t1761130000\tfeat(worktrees): view (#7)\n' : '')
    if (a.includes('log -1')) return ok(`${cwd.endsWith('wt-7') ? 'b2' : 'a1'}\t${Math.floor((NOW - 7200_000) / 1000)}\tlast commit\n`)
    return ok('')
  })
  const filled: string[] = []
  on('prompt.fill', (_$, e) => { filled.push(e.text); return { isFilled: true } })
  await $.session.start(START)
  // Nothing read until the tab opens (other tabs' git, like the status line's, may run).
  const lists = () => calls.filter(a => a.includes('worktree list')).length
  expect(lists()).toBe(0)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...PANE })
    await ui.press({ key: 'tab-worktrees' }).catch(() => undefined)
    await clock.settle()
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn.includes('wt-7')).toBe(true)
    expect(drawn.includes('#7')).toBe(true)
    expect(drawn.includes('#5')).toBe(true)
    expect(drawn.includes('2 changed')).toBe(true)
    expect(drawn.includes('not pushed')).toBe(true)
    expect(drawn.includes('folder gone')).toBe(true)
    await ui.unmount()
  }
  // One read for both surfaces: no git per render.
  expect(lists()).toBe(1)

  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE })
  await ui.press({ key: 'wt-/repo/.claude/worktrees/wt-5' })
  await ui.press({ key: 'wt-land' })
  await ui.press({ key: 'wt-remove' })
  await ui.press({ key: 'wt-open' })
  expect(filled[0]).toContain('Review and land the branch feat/issue-5-board')
  expect(filled[1]).toContain('Remove the worktree /repo/.claude/worktrees/wt-5')
  expect(filled[2]).toContain('Start a new session in the worktree /repo/.claude/worktrees/wt-5')
  // The session's own worktree offers no Remove.
  await ui.press({ key: 'wt-/repo/.claude/worktrees/wt-7' })
  expect(JSON.stringify(await ui.drawn()).includes('Remove this worktree')).toBe(false)
  await ui.unmount()

  // Open for a minute: the clock reads again; no new list without it.
  await clock.advance(61_000)
  expect(lists()).toBe(2)
})
