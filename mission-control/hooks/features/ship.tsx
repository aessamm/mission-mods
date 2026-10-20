// Release Autopilot: /ship gathers facts read-only (git, the GitHub issues its commits name or
// .ops tickets), asks the model for a PR description, changelog and a client update in Arabic
// and English, stores the result as the lastDoc atom and draws it as a card in the transcript.
// Nothing here changes the repo.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { BoardSnapshot, CommandDoc, Ticket } from '../../types'
import { chip, svg } from '../kit/draw'

const lastDoc = atom({ plugin: 'mission-control', key: 'lastDoc' } as const, null as CommandDoc | null)
const board = atom({ plugin: 'mission-control', key: 'board' } as const, null as BoardSnapshot | null)

const MODEL = 'claude-sonnet-5-5'
const MAX_COMMITS = 60
const MAX_DEPTH = 4

export type ShipTicket = { id: string; title: string }
// A GitHub issue the branch's commits name, with its board column when the board knows it.
export type ShipIssue = ShipTicket & { status?: string }
export type ShipFacts = {
  branch: string
  base: string
  commits: string[]
  commitCount: number
  shortstat: string
  done: ShipTicket[]
  review: ShipTicket[]
  issues?: ShipIssue[]       // set when the board reads GitHub; done and review are then empty
}
export type ShipDraft = { title: string; pr: string; changelog: string; clientAr: string; clientEn: string }

// ---------------------------------------------------------------- pure helpers
const unquote = (s: string) => s.trim().replace(/^(['"])(.*)\1$/, '$2').trim()

// Reads `key: value` lines between the first two `---` lines.
export function parseFrontmatter(src: string): Record<string, string> {
  const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return {}
  const out: Record<string, string> = {}
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (m) out[(m[1] ?? '').toLowerCase()] = unquote(m[2] ?? '')
  }
  return out
}

export function ticketOf(fileName: string, src: string): { status: string; ticket: ShipTicket } {
  const fm = parseFrontmatter(src)
  const stem = fileName.replace(/\.[^.]+$/, '')
  return { status: (fm.status ?? '').toLowerCase().replace(/[\s-]+/g, '_'), ticket: { id: fm.id || stem, title: fm.title || stem } }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// Tolerates code fences and prose around the JSON; returns undefined when it is not usable.
export function parseDraft(raw: string): ShipDraft | undefined {
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}')
  if (a < 0 || b <= a) return undefined
  try {
    const o = JSON.parse(raw.slice(a, b + 1)) as Record<string, unknown>
    const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : Array.isArray(o[k]) ? (o[k] as unknown[]).map(String).join('\n') : '')
    const d = { title: str('title'), pr: str('pr'), changelog: str('changelog'), clientAr: str('clientAr'), clientEn: str('clientEn') }
    return d.title && d.pr && d.changelog && d.clientAr && d.clientEn ? d : undefined
  } catch {
    return undefined
  }
}

const commitText = (line: string) => line.replace(/^[0-9a-f]{6,40}\s+/, '')

// The issues the commits name (`#28` in a subject), in first-seen order, titled from the board's
// tickets; one the board does not have is titled by the first commit that names it.
export function issuesOf(commits: string[], tickets: Ticket[]): ShipIssue[] {
  const byId = new Map(tickets.map(t => [t.id, t] as const))
  const out = new Map<string, ShipIssue>()
  for (const line of commits) {
    const subject = commitText(line)
    for (const m of subject.matchAll(/(?:^|[\s(,])#(\d{1,7})\b/g)) {
      const id = `#${m[1]}`
      if (out.has(id)) continue
      const t = byId.get(id)
      out.set(id, t ? { id, title: t.title, status: t.status } : { id, title: subject })
    }
  }
  return [...out.values()]
}
const STATUS_WORD: Record<string, string> = { todo: 'to do', in_progress: 'in progress', in_review: 'in review', waiting: 'waiting on owner', blocked: 'blocked', done: 'done' }
const issueLine = (i: ShipIssue) => `- ${i.id}: ${i.title}${i.status ? ` (${STATUS_WORD[i.status] ?? i.status})` : ''}`

export function fallbackDraft(f: ShipFacts): ShipDraft {
  const subjects = f.commits.map(commitText)
  const shown = subjects.slice(0, 12)
  const more = subjects.length - shown.length
  const issues = f.issues ?? []
  const tickets = f.done.slice(0, 12).map(t => `- ${t.id}: ${t.title}`)
  const one = issues.length === 1 ? issues[0] : f.done.length === 1 ? f.done[0] : undefined
  const title = one ? one.title : `Release from ${f.branch}`
  const changelog = (shown.length ? shown : ['No commits found']).map(s => `- ${s}`).concat(more > 0 ? [`- and ${more} more`] : []).join('\n')
  const pr = [
    '## Summary',
    `${plural(f.commitCount, 'commit')} from \`${f.branch}\` into \`${f.base}\`${f.shortstat ? ` (${f.shortstat})` : ''}.`,
    '',
    '## Changes',
    changelog,
    ...(tickets.length ? ['', '## Tickets closed', ...tickets] : []),
    ...(issues.length ? ['', '## Issues', ...issues.slice(0, 20).map(issueLine)] : []),
  ].join('\n')
  const n = issues.length || f.done.length || f.commitCount
  return {
    title,
    pr,
    changelog,
    clientAr: `أنهينا في هذا الإصدار ${n} ${n === 1 ? 'تحديثًا' : 'تحديثات'} وأصبحت جاهزة للمراجعة. التغييرات تحسّن تجربة الاستخدام وتجعل النظام أكثر استقرارًا. سنشاركك التفاصيل والتسليم النهائي قريبًا.`,
    clientEn: `This release brings ${plural(n, 'update')}, now ready for review. They make the product easier to use and more stable. We will share the details and the final hand-over shortly.`,
  }
}

export function buildPrompt(f: ShipFacts): string {
  return [
    'You are preparing a software release. From the facts below write the release documents.',
    'Reply with ONE JSON object and nothing else, with exactly these string keys:',
    '"title": a short release title in sentence case,',
    '"pr": the pull request description in markdown (a one-line summary, then a bullet list of what changed, then the tickets closed or the GitHub issues it refers to, written "#N"),',
    '"changelog": markdown bullets, one per user-visible change,',
    '"clientAr": a client update in Arabic, plain and non-technical, 3 to 5 sentences, no code or ticket ids,',
    '"clientEn": the same client update in English.',
    'Use only the facts given. Do not invent features, numbers or dates.',
    '',
    `Branch: ${f.branch}`,
    `Base: ${f.base}`,
    `Diff: ${f.shortstat || 'unknown'}`,
    `Commits (${f.commitCount}${f.commitCount > f.commits.length ? `, newest ${f.commits.length} shown` : ''}):`,
    ...(f.commits.length ? f.commits : ['(none)']),
    '',
    ...(f.issues
      ? [`GitHub issues the commits refer to, with their board column (${f.issues.length}):`, ...(f.issues.length ? f.issues.slice(0, 40).map(issueLine) : ['(none)'])]
      : [
        `Tickets closed (${f.done.length}):`,
        ...(f.done.length ? f.done.slice(0, 40).map(t => `- ${t.id}: ${t.title}`) : ['(none)']),
        ...(f.review.length ? ['', `Tickets still in review (${f.review.length}):`, ...f.review.slice(0, 20).map(t => `- ${t.id}: ${t.title}`)] : []),
      ]),
  ].join('\n')
}

export type ShipView = 'pr' | 'changelog' | 'client'
export type ShipLang = 'ar' | 'en'

const SECTIONS = ['PR description', 'Changelog', 'Client update (Arabic)', 'Client update (English)']

export function makeDoc(f: ShipFacts, d: ShipDraft, at: number): CommandDoc {
  return {
    kind: 'ship',
    at,
    title: d.title,
    sections: [d.pr, d.changelog, d.clientAr, d.clientEn].map((text, i) => ({ heading: SECTIONS[i] ?? '', lines: text.split('\n') })),
    extra: {
      branch: f.branch,
      base: f.base,
      commits: String(f.commitCount),
      tickets: String(f.done.length),
      review: String(f.review.length),
      ...(f.issues ? { issues: String(f.issues.length), open: String(f.issues.filter(i => i.status && i.status !== 'done' && i.status !== 'in_review').length) } : {}),
      shortstat: f.shortstat,
      view: 'pr',
      lang: 'ar',
    },
  }
}

const body = (doc: CommandDoc, i: number) => (doc.sections[i]?.lines ?? []).join('\n')

export function docMarkdown(doc: CommandDoc): string {
  const x = doc.extra ?? {}
  const n = Number(x.tickets ?? 0), r = Number(x.review ?? 0)
  return [
    `# ${doc.title}`,
    '',
    `${x.branch ?? ''} into ${x.base ?? ''} · ${plural(Number(x.commits ?? 0), 'commit')}${x.shortstat ? ` · ${x.shortstat}` : ''}`,
    '',
    '## Checks',
    ...(x.issues !== undefined
      ? [`- ${plural(Number(x.issues), 'GitHub issue')} named in the commits`, ...(Number(x.open) ? [`- Warning: ${plural(Number(x.open), 'issue')} not yet in Review or Done on the board`] : [])]
      : [`- ${plural(n, 'ticket')} closed`, ...(r ? [`- Warning: ${plural(r, 'ticket')} still in review`] : [])]),
    '- Tests: not run by Mission Control',
    '',
    `## ${SECTIONS[0]}`,
    body(doc, 0),
    '',
    `## ${SECTIONS[1]}`,
    body(doc, 1),
    '',
    `## ${SECTIONS[2]}`,
    body(doc, 2),
    '',
    `## ${SECTIONS[3]}`,
    body(doc, 3),
  ].join('\n')
}

export const openPrPrompt = (doc: CommandDoc): string =>
  `Open a pull request from ${doc.extra?.branch ?? 'HEAD'} to ${doc.extra?.base ?? 'main'} with this description:\n\nTitle: ${doc.title}\n\n${body(doc, 0)}`

// ---------------------------------------------------------------- gathering (read-only)
async function git($: EngineInterface, root: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const r = await $.process.run(['git', ...args], { cwd: root, timeoutMs: 15000 })
    return { ok: r.exitCode === 0, out: r.stdout.trim() }
  } catch {
    return { ok: false, out: '' }
  }
}

async function walk($: EngineInterface, dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH) return
  const entries = await $.fs.list(dir).catch(() => [])
  for (const en of entries) {
    if (en.kind === 'dir') await walk($, `${dir}/${en.name}`, depth + 1, out)
    else if (en.kind === 'file' && /\.(md|markdown|ya?ml)$/i.test(en.name)) out.push(`${dir}/${en.name}`)
  }
}

// `here` is where git runs: the session's folder, so a linked worktree ships its own branch
// (the repo root is the main checkout's). `.ops` is read from the repo root.
async function gather($: EngineInterface, root: string, here: string, arg: string, snap: BoardSnapshot | null): Promise<ShipFacts> {
  const branch = (await git($, here, ['rev-parse', '--abbrev-ref', 'HEAD'])).out || 'HEAD'
  let base = arg.trim().split(/\s+/)[0] ?? ''
  if (!base) {
    base = 'main'
    if (!(await git($, here, ['rev-parse', '--verify', '--quiet', 'main'])).ok && (await git($, here, ['rev-parse', '--verify', '--quiet', 'master'])).ok) base = 'master'
  }
  const range = `${base}..HEAD`
  const log = await git($, here, ['log', '--oneline', `-n${MAX_COMMITS}`, range])
  const count = await git($, here, ['rev-list', '--count', range])
  const stat = await git($, here, ['diff', '--shortstat', `${base}...HEAD`])
  const commits = log.ok ? log.out.split('\n').map(l => l.trim()).filter(Boolean) : []
  const facts = { branch, base, commits, commitCount: Number(count.out) || commits.length, shortstat: stat.out }
  // With the board on GitHub, .ops/tickets is history: the release is the issues its commits name.
  if (snap?.source?.kind === 'github') return { ...facts, done: [], review: [], issues: issuesOf(commits, snap.tickets) }
  const files: string[] = []
  await walk($, `${root}/.ops/tickets`, 0, files)
  const done: ShipTicket[] = [], review: ShipTicket[] = []
  for (const f of files.sort()) {
    const src = await $.fs.read(f).catch(() => '')
    if (typeof src !== 'string') continue
    const { status, ticket } = ticketOf(f.slice(f.lastIndexOf('/') + 1), src)
    if (status === 'done') done.push(ticket)
    else if (status === 'in_review') review.push(ticket)
  }
  return { ...facts, done, review }
}

// ---------------------------------------------------------------- hooks
export function registerShip(on: On): void {
  on('session.start', { isInteractive: [true, false] }, async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'ship',
      description: 'Prepare a release: checks, PR description, changelog and a client update in Arabic and English',
      argumentHint: '[base branch]',
    })
    return started
  })

  on('command.run', { command: 'ship' }, async ($, e) => {
    const repo = await $.session.repo()
    if (!repo) return { text: '/ship needs a git repository. Open a session inside one and try again.' }
    const here = await $.session.cwd().catch(() => repo.root)
    const facts = await gather($, repo.root, here, String(e.args ?? ''), await read($, board))
    let draft: ShipDraft | undefined
    try {
      const r = await $.model.complete({ model: MODEL, prompt: buildPrompt(facts), maxTokens: 2000 })
      draft = r.isAnswered ? parseDraft(r.text) : undefined
    } catch {
      draft = undefined
    }
    const doc = makeDoc(facts, draft ?? fallbackDraft(facts), await $.clock.now())
    await update($, lastDoc, () => doc)
    const note = draft ? [] : ['The model draft could not be read, so this is a plain draft built from the commits and tickets.']
    return {
      text: docMarkdown(doc),
      context: [
        'The /ship release kit above is a draft for the person to review. Nothing was pushed or opened. If asked to open the PR, fill the composer with the request; never run gh or git push yourself.',
        ...note,
      ],
    }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'ship' } }, async ($, e, next) => {
    const doc = await read($, lastDoc)
    if (!doc || doc.kind !== 'ship') return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    const x = doc.extra ?? {}
    const view: ShipView = x.view === 'changelog' || x.view === 'client' ? x.view : 'pr'
    const lang: ShipLang = x.lang === 'en' ? 'en' : 'ar'
    const nDone = Number(x.tickets ?? 0), nReview = Number(x.review ?? 0), nCommits = Number(x.commits ?? 0)
    const set = (patch: Record<string, string>) => void update($, lastDoc, d => (d && d.kind === 'ship' ? { ...d, extra: { ...d.extra, ...patch } } : d))

    const nOpen = Number(x.open ?? 0)
    const chips: { text: string; tone: 'ok' | 'warn' | 'plain'; icon: string; glyph: string }[] = [
      ...(x.issues !== undefined
        ? [{ text: plural(Number(x.issues), 'issue'), tone: 'ok' as const, icon: 'check', glyph: '✓' }, ...(nOpen ? [{ text: `${nOpen} not in Review yet`, tone: 'warn' as const, icon: 'alert', glyph: '⚠' }] : [])]
        : [{ text: `${plural(nDone, 'ticket')} closed`, tone: 'ok' as const, icon: 'check', glyph: '✓' }, ...(nReview ? [{ text: `${nReview} still in review`, tone: 'warn' as const, icon: 'alert', glyph: '⚠' }] : [])]),
      { text: 'Tests: not run by Mission Control', tone: 'plain', icon: 'run', glyph: '?' },
    ]
    let checks
    if (Svg) {
      let cx = 0
      const parts = chips.map(c => {
        const ch = chip(cx, 2, c.text, c.tone, c.icon)
        cx += ch.w + 6
        return ch.svg
      })
      const W = Math.ceil(cx)
      checks = <Svg source={svg(W, 20, parts.join(''))} alt={chips.map(c => c.text).join(', ')} width={W} height={20} />
    } else {
      checks = <Text>{chips.map(c => `${c.glyph} ${c.text}`).join('   ')}</Text>
    }

    const tab = (v: ShipView, name: string) => (
      <Button key={`view-${v}`} label={name} plain={view !== v ? true : undefined} variant={view === v ? 'primary' : undefined} onPress={() => set({ view: v })} />
    )
    const pill = (l: ShipLang, name: string) => (
      <Button key={`lang-${l}`} label={name} plain={lang !== l ? true : undefined} variant={lang === l ? 'primary' : undefined} onPress={() => set({ lang: l })} />
    )

    const shown = view === 'pr' ? body(doc, 0) : view === 'changelog' ? body(doc, 1) : lang === 'ar' ? body(doc, 2) : body(doc, 3)

    return (
      <Box key="ship-card" flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{`/ship  ${doc.title}`}</Text>
          <Text dimColor>{`${plural(nDone, 'ticket')} · ${plural(nCommits, 'commit')}${x.branch ? ` · ${x.branch} into ${x.base}` : ''}${x.shortstat ? ` · ${x.shortstat}` : ''}`}</Text>
        </Box>
        {checks}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {tab('pr', 'PR description')}
          {tab('changelog', 'Changelog')}
          {tab('client', 'Client update')}
        </Box>
        {view === 'client' && (
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text dimColor>Client update</Text>
            {pill('ar', 'العربية')}
            {pill('en', 'English')}
          </Box>
        )}
        <Text>{shown}</Text>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="copy" label="Copy all" variant="primary" onPress={press => void $.ui.copy({ text: docMarkdown(doc), surface: press.surface })} />
          <Button key="open-pr" label="Open PR" onPress={() => void $.prompt.fill({ text: openPrPrompt(doc), mode: 'replace' })} />
        </Box>
      </Box>
    )
  })
}
