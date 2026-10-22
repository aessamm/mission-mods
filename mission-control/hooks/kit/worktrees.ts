// The Worktrees tab's pure side: what read-only git prints, parsed, and the words its
// buttons put in the composer. No $ here; worktrees.tsx runs git and passes the text in.

// One block of `git worktree list --porcelain`.
export type WorktreeEntry = {
  path: string
  head: string
  branch?: string           // "main", from "refs/heads/main"
  isBare: boolean
  isDetached: boolean
  isLocked: boolean
  isPrunable: boolean       // its folder is gone
}

const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

// Blocks are separated by a blank line; the first is the main worktree.
export function parseWorktreeList(src: string): WorktreeEntry[] {
  const out: WorktreeEntry[] = []
  let cur: WorktreeEntry | null = null
  for (const line of src.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur)
      cur = { path: slash(line.slice(9).trim()), head: '', isBare: false, isDetached: false, isLocked: false, isPrunable: false }
      continue
    }
    if (!cur) continue
    if (line.startsWith('HEAD ')) cur.head = line.slice(5).trim()
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '')
    else if (line === 'bare') cur.isBare = true
    else if (line === 'detached') cur.isDetached = true
    else if (line === 'locked' || line.startsWith('locked ')) cur.isLocked = true
    else if (line === 'prunable' || line.startsWith('prunable ')) cur.isPrunable = true
  }
  if (cur) out.push(cur)
  return out
}

// `git status --porcelain=v2 --branch`: the changed paths and where the branch stands
// against its upstream. No upstream line: the branch was never pushed.
export type StatusInfo = { changes: number; upstream?: string; ahead?: number; behind?: number }
export function parseStatus(src: string): StatusInfo {
  const out: StatusInfo = { changes: 0 }
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (line.startsWith('# branch.upstream ')) out.upstream = line.slice(18).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+)\s+-(\d+)/.exec(line)
      if (m) { out.ahead = Number(m[1]); out.behind = Number(m[2]) }
    } else if (!line.startsWith('#')) out.changes++
  }
  return out
}

// `git log --format=%h%x09%ct%x09%s`: short sha, commit time in seconds, subject.
export type CommitLine = { sha: string; at: number; subject: string }
export function parseLog(src: string): CommitLine[] {
  return src.split(/\r?\n/).filter(l => l.trim()).map(l => {
    const [sha = '', ct = '', ...rest] = l.split('\t')
    return { sha: sha.trim(), at: Number(ct) * 1000 || 0, subject: rest.join('\t').trim() }
  }).filter(c => c.sha)
}

// The issue a worktree works on: "#7", "issue-7", "issues/7" or "gh-7" in the branch name,
// else the newest "#7" in its own commits' subjects. A bare number in a branch name is not
// taken: worktree names carry counters ("worktrees-7-17f58a").
export function issueOf(branch: string | undefined, subjects: string[]): string | undefined {
  const b = /(?:#|\bissues?[-_/]?|\bgh[-_])(\d{1,6})\b/i.exec(branch ?? '')
  if (b) return `#${b[1]}`
  for (const s of subjects) {
    const m = /#(\d{1,6})\b/.exec(s)
    if (m) return `#${m[1]}`
  }
  return undefined
}

// The worktree's folder name, or "<repo> (main)" for the main one.
export function shortPath(path: string, isMain: boolean): string {
  const name = slash(path).split('/').pop() || path
  return isMain ? `${name} (main)` : name
}

// "now", "12m", "5h", "3d", "6w" since a time.
export function ago(at: number, now: number): string {
  if (!at) return ''
  const m = Math.max(0, Math.floor((now - at) / 60_000))
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h`
  const d = Math.floor(h / 24)
  return d < 21 ? `${d}d` : `${Math.floor(d / 7)}w`
}

// Where the branch stands against its upstream, in a few words.
export function syncOf(w: { branch?: string; upstream?: string; ahead?: number; behind?: number }): string {
  if (!w.branch) return 'detached'
  if (!w.upstream) return 'not pushed'
  const parts = [w.ahead ? `↑${w.ahead}` : '', w.behind ? `↓${w.behind}` : ''].filter(Boolean)
  return parts.length ? parts.join(' ') : 'in sync'
}

// What the buttons put in the composer. The mod runs no git writes: Claude does, once the
// person sends the line.
type Named = { path: string; branch?: string; issue?: string }
const what = (w: Named) => `${w.branch ? `the branch ${w.branch}` : 'the detached HEAD'} in the worktree ${w.path}${w.issue ? ` (${w.issue})` : ''}`

export const landPrompt = (w: Named, base: string) =>
  `Review and land ${what(w)}: read its diff against ${base}, run the project's gates, and if they pass merge it into ${base} and move its card.`

export const removePrompt = (w: Named) =>
  `Remove the worktree ${w.path}${w.branch ? ` (branch ${w.branch})` : ''}. Check it is clean first: no uncommitted changes and no commits that are neither pushed nor merged. If it is not clean, stop and tell me what is left.`

export const sessionPrompt = (w: Named) =>
  `Start a new session in the worktree ${w.path}${w.branch ? ` on the branch ${w.branch}` : ''}${w.issue ? ` to carry on with ${w.issue}` : ''}.`
