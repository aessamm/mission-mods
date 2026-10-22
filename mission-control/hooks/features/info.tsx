// Info: what Mission Control is, its version, What's new in it and the earlier releases from
// its CHANGELOG.md, the Mission Mods family with what is installed and a button to install,
// turn on, turn off or remove each one, credits, and links.
// Family buttons fill the composer with the request; the person sends it, the mod never
// installs anything itself.
// Pattern: this file owns its hooks; its Pane hook draws only when its tab is active.
import { atom, read, update } from 'claude-code'
import { failedView } from '../kit/ui'
import type { EngineInterface, On, RenderElement } from 'claude-code'

import type { AgentRecord, BoardSnapshot, Delegation, FamilyMember, FamilyState, Release, Settings, WhatsNew } from '../../types'
import { activeTab, badgesFrom, tabBar } from '../kit/chrome'
import { crab } from '../kit/crabs'
import { box, chip, para, svg, text, textWidth, wide } from '../kit/draw'
import type { PaneInput } from '../kit/state'
import type { TabCtx, UiTable } from '../kit/state'
import { DEFAULT_PANEL, DEFAULT_SETTINGS, makeCtx, settingsOf } from '../kit/state'
import { section } from '../kit/ui'
import { claudeDirOf } from '../kit/paths'
import { parseChangelog, releaseOf, updateToast } from '../kit/changelog'
import type { HomeEnv } from '../kit/paths'

const agents = atom({ plugin: 'mission-control', key: 'agents' } as const, {} as Record<string, AgentRecord>)
const board = atom({ plugin: 'mission-control', key: 'board' } as const, null as BoardSnapshot | null)
const delegations = atom({ plugin: 'mission-control', key: 'delegations' } as const, {} as Record<string, Delegation>)
const panel = atom({ plugin: 'mission-control', key: 'panel' } as const, DEFAULT_PANEL)
const settings = atom({ plugin: 'mission-control', key: 'settings' } as const, DEFAULT_SETTINGS)
const family = atom({ plugin: 'mission-control', key: 'family' } as const, null as FamilyMember[] | null)
const whatsNew = atom({ plugin: 'mission-control', key: 'whatsNew' } as const, null as WhatsNew | null)

// When the family was last read; a reload reads it again, which is what we want.
const scanned = { at: 0 }
const REPO = 'https://github.com/aessamm/mission-mods'
const MARKET = 'mission-mods'
// $.store key: the version a session last started with, for the toast after an update.
const SEEN_VERSION = 'seenVersion'

export const FAMILY: Omit<FamilyMember, 'state'>[] = [
  { id: 'mission-control', name: 'Mission Control', what: 'Panel, status line, /standup, /ship' },
  { id: 'guardrails', name: 'Guardrails', what: 'Blocks risky commands, runs tests, checks RTL' },
  { id: 'brain', name: 'Brain', what: 'Project memory, model routing, team kickoff' },
]

// The five walking crabs over the title, version and one line of what it is.
const HERO: [string, string][] = [['scout', '#378ADD'], ['builder', '#BA7517'], ['reviewer', '#C2558F'], ['tester', '#1D9E75'], ['refactorer', '#3B9C5F']]
const TAGLINE = 'One place to watch your agents, delegations, tickets, spend and day, inside Claude Code.'

// What each state is called, and its chip tone.
const STATE: Record<FamilyState, [string, 'ok' | 'plain' | 'warn']> = {
  on: ['Installed', 'ok'],
  off: ['Turned off', 'warn'],
  available: ['Not installed', 'plain'],
  soon: ['Coming soon', 'plain'],
}

// Which state a mod is in, from the installed list, the enabled flags and the marketplace.
export function stateOf(id: string, installed: Set<string>, enabled: Record<string, boolean>, inMarket: Set<string>): FamilyState {
  const key = `${id}@${MARKET}`
  if (installed.has(key)) return enabled[key] === false ? 'off' : 'on'
  return inMarket.has(id) ? 'available' : 'soon'
}

// The request a family button puts in the composer.
export function requestFor(action: 'install' | 'on' | 'off' | 'remove' | 'update', id: string, name: string): string {
  const ref = `${id}@${MARKET}`
  switch (action) {
    case 'install': return `Install the ${name} mod: run \`claude plugin install ${ref} --scope user\`, then tell me to run /reload-plugins.`
    case 'on': return `Turn the ${name} mod back on: run \`claude plugin enable ${ref}\`, then tell me to run /reload-plugins.`
    case 'off': return `Turn the ${name} mod off: run \`claude plugin disable ${ref}\`, then tell me to run /reload-plugins.`
    case 'remove': return `Remove the ${name} mod: run \`claude plugin uninstall ${ref}\`, then tell me to run /reload-plugins.`
    case 'update': return `Update Mission Control: run \`claude plugin marketplace update ${MARKET}\` and \`claude plugin update ${ref}\`, then tell me to run /reload-plugins.`
  }
}

async function readJson($: EngineInterface, path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(String(await $.fs.read(path))) as Record<string, unknown>
  } catch {
    return {}
  }
}

// The environment's home folder (see kit/paths.ts for the rules on each system).
async function homeEnv($: EngineInterface): Promise<HomeEnv> {
  const get = (v: Promise<string | undefined>) => v.catch(() => undefined)
  return { userProfile: await get($.env.get('USERPROFILE')), home: await get($.env.get('HOME')), configDir: await get($.env.get('CLAUDE_CONFIG_DIR')) }
}

// Reads Claude Code's plugin records; quick enough for session start and opening Info.
async function scanFamily($: EngineInterface): Promise<void> {
  const dir = claudeDirOf(await homeEnv($))
  if (!dir) return
  const installedFile = await readJson($, `${dir}/plugins/installed_plugins.json`)
  const settingsFile = await readJson($, `${dir}/settings.json`)
  const markets = await readJson($, `${dir}/plugins/known_marketplaces.json`)
  const where = String(((markets[MARKET] ?? {}) as { installLocation?: string }).installLocation ?? '').replace(/\\/g, '/')
  const market = where ? await readJson($, `${where}/.claude-plugin/marketplace.json`) : {}
  const installed = new Set(Object.keys((installedFile.plugins ?? {}) as Record<string, unknown>))
  const enabled = (settingsFile.enabledPlugins ?? {}) as Record<string, boolean>
  const inMarket = new Set(((market.plugins ?? []) as { name?: string }[]).map(p => p.name ?? ''))
  const own = await readJson($, `${$.plugin.root.replace(/\\/g, '/')}/.claude-plugin/plugin.json`)
  const next: FamilyMember[] = FAMILY.map(f => ({
    ...f,
    state: f.id === 'mission-control' ? 'on' : stateOf(f.id, installed, enabled, inMarket),
    version: f.id === 'mission-control' && typeof own.version === 'string' ? own.version : undefined,
  }))
  await update($, family, () => next)
}

// The mod's own version and changelog, both from its folder. After an update (a version seen
// before and this one differs) one toast says so; a first install only records the version.
async function loadWhatsNew($: EngineInterface): Promise<void> {
  const root = $.plugin.root.replace(/\\/g, '/')
  const own = await readJson($, `${root}/.claude-plugin/plugin.json`)
  const version = typeof own.version === 'string' ? own.version : ''
  const releases = parseChangelog(String(await $.fs.read(`${root}/CHANGELOG.md`).catch(() => '')))
  await update($, whatsNew, () => ({ version, releases }))
  if (!version) return
  const seen = await $.store.get(SEEN_VERSION).catch(() => undefined)
  const toast = updateToast(typeof seen === 'string' ? seen : undefined, version)
  if (toast) $.ui.toast(toast)
  if (seen !== version) await $.store.set(SEEN_VERSION, version).catch(() => undefined)
}

// ---------------------------------------------------------------- drawing
function heroSvg(W: number, s: Settings, verLine: string): { H: number; svg: string } {
  const cell = 36, x0 = W / 2 - (HERO.length * cell) / 2
  const crabs = HERO.map(([role, color], i) => crab(x0 + i * cell + 3, 8, role, color, s.look.motion !== 'off', 1)).join('')
  const title = text(W / 2, 64, 'Mission Control', { size: 17, weight: 700, anchor: 'middle' })
  const ver = text(W / 2, 82, verLine, { size: 11.5, cls: 's', anchor: 'middle' })
  const tag = para(W / 2, 106, TAGLINE, Math.min(W - 24, 320), { size: 12, anchor: 'middle', lh: 17 })
  const H = 106 + tag.h
  return { H, svg: wide(W, H, crabs + title + ver + tag.svg, s.look.theme, s.look.motion) }
}

// One family member: its name and state chip on the first line, what it does under it.
// Drawn without a ground of its own: the bordered box around it holds its buttons too.
function memberSvg(w: number, s: Settings, m: FamilyMember): string {
  const [word, tone] = STATE[m.state]
  const label = m.state === 'on' ? `✓ ${word}` : word
  const nameW = textWidth(m.name, 12.5) * 1.05 + 10
  const body = text(0, 15, m.name, { size: 12.5, weight: 700, max: w - 90 })
    + chip(Math.min(nameW, w - 90), 3, label, tone).svg
    + text(0, 33, m.what, { size: 11, cls: 's', max: w })
  return svg(w, 40, body, s.look.theme, s.look.motion)
}

// The people and projects Mission Control builds on, what each gave, and where it lives.
export const CREDITS: { name: string; by: string; license: string; what: string; href?: string }[] = [
  { name: 'savvy-progress', by: 'johnnyvizz', license: 'MIT', what: 'The crab body, six costumes and their animations', href: 'https://github.com/johnnyvizz/claude-kit' },
  { name: 'Pixel Clawd', by: 'DockCrab', license: 'via savvy-progress', what: 'The pixel crab savvy-progress is drawn after' },
  { name: 'Desktop Statusline', by: 'George Liu', license: 'MIT', what: 'The status line above the prompt is modelled on it', href: 'https://github.com/centminmod/claude-plugins/tree/master/plugins/desktop-statusline' },
  { name: 'Lucide', by: 'Lucide Contributors', license: 'ISC', what: 'The interface icons across the panel and the status line', href: 'https://lucide.dev' },
  { name: 'Impeccable', by: 'Paul Bakaus', license: 'MIT', what: 'The design direction and reviews behind Mission Mods', href: 'https://impeccable.style' },
  { name: 'delegate-skills', by: 'Ahmed Nagdy', license: 'MIT', what: 'codex-, agy-, opencode- and claude-delegate ship with this mod; the Delegations tab follows the runs they start', href: 'https://github.com/amElnagdy/delegate-skills' },
]

function creditSvg(w: number, s: Settings, c: (typeof CREDITS)[number]): { H: number; svg: string } {
  const head = text(0, 15, c.name, { size: 12.5, weight: 700, max: w * 0.6 })
    + text(Math.min(textWidth(c.name, 12.5) * 1.05 + 10, w * 0.6 + 6), 15, `${c.by} · ${c.license}`, { size: 11, cls: 's', max: w * 0.4 })
  const p = para(0, 33, c.what, w, { size: 11.5, cls: 's', lh: 16 })
  return { H: 24 + p.h, svg: svg(w, 24 + p.h, head + p.svg, s.look.theme, s.look.motion) }
}

// A paragraph as a picture, so it wraps evenly with the rest of the tab.
function noteSvg(W: number, s: Settings, line: string): { H: number; svg: string } {
  const p = para(0, 14, line, W, { size: 12, lh: 17 })
  return { H: p.h + 2, svg: wide(W, p.h + 2, p.svg, s.look.theme, s.look.motion) }
}

// ---------------------------------------------------------------- the tab
// What's new in this version, then the earlier releases, each opened by its own button.
function renderReleases(c: TabCtx, s: Settings, news: WhatsNew | null, expanded: Record<string, boolean>, toggle: (key: string) => void): RenderElement[] {
  const { Box, Button, Text, Markdown } = c.ui
  const list = news?.releases ?? []
  const now = news ? releaseOf(list, news.version) : undefined
  const bullets = (r: Release) => r.bullets.map(b => `- ${b}`).join('\n')
  const earlier = list.filter(r => r !== now)
  return [
    section(c, s.look, 'whats-new', `What's new${now ? ` in ${now.version}` : ''}`, now?.title || undefined),
    now?.bullets.length
      ? <Markdown key="whats-new-md">{bullets(now)}</Markdown>
      : <Text key="whats-new-none" dimColor>No changelog came with this version.</Text>,
    ...(earlier.length ? [
      section(c, s.look, 'changelog', 'Changelog', 'Earlier releases'),
      <Box key="changelog-list" flexDirection="column">
        {earlier.map(r => {
          const key = `cl-${r.version}`
          const isOpen = !!expanded[key]
          return (
            <Box key={key} flexDirection="column">
              <Button key={key} label={`${isOpen ? '▾' : '▸'} ${r.version}${r.title ? ` · ${r.title}` : ''}`} plain onPress={() => toggle(key)} />
              {isOpen && r.bullets.length > 0 && <Markdown key={`${key}-md`}>{bullets(r)}</Markdown>}
            </Box>
          )
        })}
      </Box>,
    ] : []),
  ]
}

function renderInfo($: EngineInterface, c: TabCtx, s: Settings, members: FamilyMember[] | null, news: WhatsNew | null, expanded: Record<string, boolean>): RenderElement {
  const { ui, isDesktop, W } = c
  const { Box, Button, Text } = ui
  const Svg = 'Svg' in ui ? ui.Svg : undefined
  const Link = 'Link' in ui ? ui.Link : undefined
  const look = s.look
  const fill = (t: string) => () => void $.prompt.fill({ text: t, mode: 'replace' })
  const list: FamilyMember[] = members ?? FAMILY.map(f => ({ ...f, state: f.id === 'mission-control' ? 'on' : 'soon' }))
  const version = news?.version || list.find(m => m.id === 'mission-control')?.version || ''
  const verLine = `${version ? `Version ${version} · ` : ''}part of Mission Mods`
  const toggle = (key: string) => void update($, panel, q => ({ ...q, expanded: { ...q.expanded, [key]: !q.expanded[key] } }))

  const actions = (m: FamilyMember): RenderElement[] => {
    if (m.id === 'mission-control') return [<Button key={`fam-${m.id}-update`} label="Check for updates" onPress={fill(requestFor('update', m.id, m.name))} />]
    if (m.state === 'available') return [<Button key={`fam-${m.id}-install`} label="Install" variant="primary" onPress={fill(requestFor('install', m.id, m.name))} />]
    if (m.state === 'off') return [
      <Button key={`fam-${m.id}-on`} label="Turn on" variant="primary" onPress={fill(requestFor('on', m.id, m.name))} />,
      <Button key={`fam-${m.id}-remove`} label="Remove" dimColor onPress={fill(requestFor('remove', m.id, m.name))} />,
    ]
    if (m.state === 'on') return [
      <Button key={`fam-${m.id}-off`} label="Turn off" onPress={fill(requestFor('off', m.id, m.name))} />,
      <Button key={`fam-${m.id}-remove`} label="Remove" dimColor onPress={fill(requestFor('remove', m.id, m.name))} />,
    ]
    return []
  }

  const hero = heroSvg(W, s, verLine)
  const made = noteSvg(W, s, 'Ahmed, with Claude.')
  return (
    <Box flexDirection="column">
      {isDesktop && Svg
        ? <Svg source={hero.svg} alt={`Mission Control, ${verLine}. ${TAGLINE}`} height={hero.H} />
        : <Box flexDirection="column" alignItems="center"><Text>🦀 🦀 🦀 🦀 🦀</Text><Text bold>Mission Control</Text><Text dimColor>{verLine}</Text><Text>{TAGLINE}</Text></Box>}

      {renderReleases(c, s, news, expanded, toggle)}

      {section(c, look, 'family', 'The Mission Mods family', 'A button puts the request in the prompt; send it and Claude runs it.')}
      <Box flexDirection="column" gap={1}>
        {list.map(m => {
          const acts = actions(m)
          const [word] = STATE[m.state]
          const actW = m.id === 'mission-control' ? 150 : m.state === 'available' ? 80 : acts.length ? 170 : 0
          const w = Math.max(140, W - actW - 34)
          return (
            <Box key={`fam-${m.id}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} borderStyle="round" borderDimColor paddingX={1}>
              {isDesktop && Svg
                ? <Svg source={memberSvg(w, s, m)} alt={`${m.name}: ${m.what}. ${word}.`} width={w} height={40} />
                : <Text>{`${m.name}  ${word}  ${m.what}`}</Text>}
              {acts.length ? <Box flexDirection="row" gap={1} flexShrink={0}>{acts}</Box> : null}
            </Box>
          )
        })}
      </Box>

      {section(c, look, 'made', 'Made by')}
      {isDesktop && Svg ? <Svg source={made.svg} alt="Ahmed, with Claude." height={made.H} /> : <Text>Ahmed, with Claude.</Text>}

      {section(c, look, 'credits', 'Credits', 'Made with the work of these people and projects. Thank you.')}
      <Box flexDirection="column" gap={1}>
        {CREDITS.map(cr => {
          const w = Math.max(140, W - (cr.href && Link ? 80 : 0))
          const block = creditSvg(w, s, cr)
          return (
            <Box key={`credit-${cr.name}`} flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
              {isDesktop && Svg
                ? <Svg source={block.svg} alt={`${cr.name}, ${cr.by}, ${cr.license}: ${cr.what}`} width={w} height={block.H} />
                : <Text>{`${cr.name} · ${cr.by} · ${cr.license}: ${cr.what}`}</Text>}
              {cr.href && Link ? <Link key={`credit-link-${cr.name}`} href={cr.href} label="Source" /> : null}
            </Box>
          )
        })}
      </Box>

      {section(c, look, 'links', 'Links')}
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {Link ? <Link key="info-repo" href={REPO} label="Mission Mods on GitHub" /> : <Button key="info-repo" label="GitHub" onPress={fill(REPO)} />}
        {Link ? <Link key="info-report" href={`${REPO}/issues/new`} label="Report a problem" /> : <Button key="info-report" label="Report a problem" onPress={fill(`${REPO}/issues/new`)} />}
      </Box>
    </Box>
  )
}

export function registerInfo(on: On): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    const r = await next(e)
    void scanFamily($).catch(() => undefined)
    void loadWhatsNew($).catch(() => undefined)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: 'mission-control' }, async ($, e, next) => {
    const p = { ...DEFAULT_PANEL, ...(await read($, panel)) }
    const s = settingsOf(await read($, settings))
    if (activeTab(p.tab, s) !== 'info') return next(e)
    const ui: UiTable = $.ui.resolve(e)
    const c = makeCtx(e, ui, await $.clock.now())
    // What is installed is read again whenever Info is open, at most every 15 seconds.
    if (c.at - scanned.at > 15_000) {
      scanned.at = c.at
      void scanFamily($).catch(() => undefined)
    }
    const { Box } = ui
    const badges = badgesFrom(await read($, agents), await read($, delegations), await read($, board))
    return (
      <Box flexDirection="column" gap={1}>
        {tabBar(ui, 'info', badges, s, t => void update($, panel, q => ({ ...q, tab: t })), c.isDesktop ? c.W : 0, c.at)}
        {renderInfo($, c, s, await read($, family), await read($, whatsNew), p.expanded)}
      </Box>
    )
  }).catch(($, e, next) => paneFailed($, e, next.error, 'info'))
}

// When drawing fails, say so in the pane (and keep the reason for a bug report) instead of
// leaving it blank.
async function paneFailed($: EngineInterface, e: PaneInput, error: unknown, where: string): Promise<RenderElement> {
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : JSON.stringify(error)
  await $.store.set('lastError', { where, reason, at: await $.clock.now() }).catch(() => undefined)
  return failedView($.ui.resolve(e), where, reason)
}
