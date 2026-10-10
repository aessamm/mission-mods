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

// "~" and "~/x" become the home folder; anything else is returned as it is.
export function expandHome(p: string, home: string): string {
  if (!home) return p
  if (p === '~') return home
  if (p.startsWith('~/') || p.startsWith('~\\')) return `${home}/${p.slice(2)}`
  return p
}
