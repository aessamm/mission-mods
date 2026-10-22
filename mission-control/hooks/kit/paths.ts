// Home, config and temp folders the way Node and Claude Code find them, on every system.
// Pure: each feature file reads the environment itself ($ never crosses files) and passes
// the values in.

const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const isWinPath = (p: string | undefined) => !!p && /^[A-Za-z]:[\\/]/.test(p)

export type HomeEnv = { userProfile?: string; home?: string; configDir?: string }

// The home folder: USERPROFILE on Windows, HOME elsewhere. USERPROFILE is only trusted when
// it is a Windows path, so a Windows value leaking into WSL or Git Bash's POSIX HOME on
// Windows never wins on the wrong system.
export function homeOf(env: HomeEnv): string {
  if (isWinPath(env.userProfile)) return slash(env.userProfile as string)
  if (env.home) return slash(env.home)
  return env.userProfile ? slash(env.userProfile) : ''
}

export const isWindowsHome = (home: string) => isWinPath(home)

// Claude Code's own folder: CLAUDE_CONFIG_DIR when set, else <home>/.claude.
export function claudeDirOf(env: HomeEnv): string {
  if (env.configDir) return slash(env.configDir)
  const home = homeOf(env)
  return home ? `${home}/.claude` : ''
}

// Where Node's os.tmpdir() points: TEMP, then TMP on Windows; TMPDIR, then TMP, then TEMP,
// then /tmp elsewhere. That is where the delegate relays write by default.
export function tmpOf(windows: boolean, env: { tmpdir?: string; temp?: string; tmp?: string }): string {
  const pick = windows ? env.temp || env.tmp || '' : env.tmpdir || env.tmp || env.temp || '/tmp'
  return pick ? slash(pick) : ''
}

// The parent folder of a path ('' for a root).
export const parentOf = (p: string): string => {
  const s = slash(p)
  const i = s.lastIndexOf('/')
  return i > 0 ? s.slice(0, i) : ''
}

// `rel` resolved against the folder `base`, with "." and ".." folded; an absolute `rel` as it is.
export function resolveIn(base: string, rel: string): string {
  const r = slash(rel)
  if (/^([A-Za-z]:)?\//.test(r)) return r
  const out = slash(base).split('/')
  for (const part of r.split('/')) {
    if (part === '..') { if (out.length > 1) out.pop() }
    else if (part && part !== '.') out.push(part)
  }
  return out.join('/')
}

// The same folder, whatever the slashes and (on Windows) the letter case.
export const samePath = (a: string, b: string): boolean => {
  const x = slash(a), y = slash(b)
  return isWinPath(x) || isWinPath(y) ? x.toLowerCase() === y.toLowerCase() : x === y
}

// Mission Control's folder from MC_RUN_LOG (".../mission-control/scripts/run-log.mjs").
export const mcDirOfRunLog = (p: string): string => {
  const s = p.trim().replace(/\\/g, '/')
  return /\/scripts\/run-log\.mjs$/.test(s) ? s.replace(/\/scripts\/run-log\.mjs$/, '') : ''
}

// Where Mission Control may live, in the order the Board and Delegations look: MC_DIR, the folder of
// MC_RUN_LOG's script, a "mission-control" folder beside the repo.
export function mcDirsOf(mcDir: string | undefined, runLog: string | undefined, root: string): string[] {
  const dirs = [mcDir ?? '', runLog ? mcDirOfRunLog(runLog) : '', root ? `${parentOf(root)}/mission-control` : '']
  return [...new Set(dirs.filter(x => x.trim()).map(x => x.trim().replace(/\\/g, '/').replace(/\/+$/, '')))]
}

// "~" and "~/x" become the home folder; anything else is returned as it is.
export function expandHome(p: string, home: string): string {
  if (!home) return p
  if (p === '~') return home
  if (p.startsWith('~/') || p.startsWith('~\\')) return `${home}/${p.slice(2)}`
  return p
}
