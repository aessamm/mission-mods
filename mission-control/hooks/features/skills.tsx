// Companion skills: the kickoff and the four delegate skills ship inside the mod, in
// bundled-skills/ (a folder Claude Code does not load as plugin skills, so nothing doubles
// up), and are copied to ~/.claude/skills/<name> at session start when they are missing.
// A copy the person made is never touched; a copy this mod made carries a marker and is
// refreshed when the bundle changes. Help reads the result to say what is installed.
import { atom, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { CompanionSkill, Settings } from '../../types'
import { STORE } from '../kit/state'
import { claudeDirOf } from '../kit/paths'
import type { HomeEnv } from '../kit/paths'

const skills = atom({ plugin: 'mission-control', key: 'skills' } as const, null as CompanionSkill[] | null)

const MARK = '.mission-control.json'
type Manifest = Record<string, { files: string[]; hash: string }>
type Mark = { hash?: string }

async function readMark($: EngineInterface, dir: string): Promise<Mark | null> {
  try {
    return JSON.parse(String(await $.fs.read(`${dir}/${MARK}`))) as Mark
  } catch {
    return null
  }
}

// The environment's home folder (see kit/paths.ts for the rules on each system).
async function homeEnv($: EngineInterface): Promise<HomeEnv> {
  const get = (v: Promise<string | undefined>) => v.catch(() => undefined)
  return { userProfile: await get($.env.get('USERPROFILE')), home: await get($.env.get('HOME')), configDir: await get($.env.get('CLAUDE_CONFIG_DIR')) }
}

async function syncSkills($: EngineInterface): Promise<void> {
  const saved = (await $.store.get(STORE.settings).catch(() => undefined)) as Partial<Settings> | undefined
  if (saved?.show?.skills === false) return
  const root = $.plugin.root.replace(/\\/g, '/')
  const manifest = JSON.parse(String(await $.fs.read(`${root}/bundled-skills/manifest.json`))) as Manifest
  const claudeDir = claudeDirOf(await homeEnv($))
  if (!claudeDir) return
  const out: CompanionSkill[] = []
  const added: string[] = []
  for (const [name, m] of Object.entries(manifest)) {
    const dir = `${claudeDir}/skills/${name}`
    const has = await $.fs.exists(`${dir}/SKILL.md`).catch(() => false)
    let mark: Mark | null = null
    if (has) mark = await readMark($, dir)
    if (has && !mark) { out.push({ name, state: 'yours', where: dir }); continue }
    if (has && mark?.hash === m.hash) { out.push({ name, state: 'mod', where: dir }); continue }
    try {
      for (const f of m.files) await $.fs.write(`${dir}/${f}`, String(await $.fs.read(`${root}/bundled-skills/${name}/${f}`)))
      await $.fs.write(`${dir}/${MARK}`, JSON.stringify({ by: 'mission-control', hash: m.hash }, null, 1))
      out.push({ name, state: 'mod', where: dir })
      if (!has) added.push(name)
    } catch {
      out.push({ name, state: 'failed', where: dir })
    }
  }
  await update($, skills, () => out)
  if (added.length) $.ui.toast(`Mission Control installed ${added.join(', ')} in ~/.claude/skills; they are ready from your next session.`)
}

export function registerSkills(on: On): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    // Started before the rest of session start and not awaited: it never delays the session.
    void syncSkills($).catch(() => undefined)
    return next(e)
  })
}
