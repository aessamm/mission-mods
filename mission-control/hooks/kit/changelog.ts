// Pure helpers for What's new: the mod's CHANGELOG.md as releases with their bullets, and
// whether a session start follows an update. No `$` here, so tests exercise them directly.
import type { Release } from '../../types'

// `## mission-control 0.11.0 — act from the board` starts a release; `- ` starts a bullet and
// indented lines under it continue it. Anything else (the `# Changelog` title, blank lines,
// another mod's heading) is skipped. Newest first, as the file is written.
export function parseChangelog(src: string): Release[] {
  const out: Release[] = []
  let cur: Release | null = null
  for (const line of src.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const h = /^##\s+mission-control\s+v?(\d+\.\d+\.\d+\S*)\s*(?:[—–:-]+\s*(.*?))?\s*$/.exec(line)
    if (h) {
      cur = { version: h[1]!, title: h[2] ?? '', bullets: [] }
      out.push(cur)
      continue
    }
    if (/^#/.test(line)) { cur = null; continue }
    if (!cur) continue
    const b = /^[-*]\s+(.*)$/.exec(line)
    if (b) cur.bullets.push(b[1]!.trim())
    else if (/^\s+\S/.test(line) && cur.bullets.length) cur.bullets[cur.bullets.length - 1] += ` ${line.trim()}`
  }
  return out
}

// The release a version names, else the newest one written.
export const releaseOf = (list: Release[], version: string): Release | undefined =>
  list.find(r => r.version === version) ?? list[0]

// The toast after an update: only when a version was seen before and this one differs, so a
// first install stays quiet.
export function updateToast(seen: string | undefined, version: string): string | undefined {
  if (!version || !seen || seen === version) return undefined
  return `Mission Control updated to ${version}. What's new: /mission info`
}
