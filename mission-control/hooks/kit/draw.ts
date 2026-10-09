// Mission Mods drawing kit for the desktop surface: every visual block is one SVG
// (the desktop wraps sibling elements onto new lines), built from these pieces.
// Colours are Mission Mods tokens as CSS classes, light by default and dark under
// prefers-color-scheme, or pinned by the Theme setting.
import { CRAB_CSS, crab } from './crabs'
export { crab }

export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif"
export const MONO = "ui-monospace,'Cascadia Mono',Consolas,monospace"

// Mission Mods tokens.
export const LIGHT = { surface: '#fbfbfa', tile: '#f4f3f0', track: '#ecebe8', hairline: '#e4e4e1', ink: '#1f1f1f', muted: '#6b6b68', faint: '#9a9a96', ok: '#3b9c5f', fail: '#d0453f', failTint: '#fbeceb', warn: '#ba7517' }
export const DARK = { surface: '#1f1e1d', tile: '#262625', track: '#2c2c2b', hairline: '#333331', ink: '#ececec', muted: '#a8a8a4', faint: '#7d7d79', ok: '#3b9c5f', fail: '#d0453f', failTint: '#3a2322', warn: '#d89a3a' }
export type Theme = 'follow' | 'light' | 'dark'

const rules = (c: typeof LIGHT) =>
  `.t{fill:${c.ink}}.s{fill:${c.muted}}.m{fill:${c.faint}}.k{fill:${c.track}}.tile{fill:${c.tile}}.sf{fill:${c.surface}}.ln{stroke:${c.hairline}}.ok{fill:${c.ok}}.fl{fill:${c.fail}}.ft{fill:${c.failTint}}.wn{fill:${c.warn}}.st-ink{stroke:${c.ink};color:${c.ink}}.st-s{stroke:${c.muted};color:${c.muted}}.st-ok{stroke:${c.ok};color:${c.ok}}.st-fl{stroke:${c.fail};color:${c.fail}}.st-wn{stroke:${c.warn};color:${c.warn}}.st-m{stroke:${c.faint}}.rim{stroke:${c.hairline}}`

export const css = (theme: Theme, motion: 'full' | 'calm' | 'off' = 'full', isMoving = true) => `<style>
${theme === 'dark' ? rules(DARK) : rules(LIGHT)}
${theme === 'follow' ? `@media (prefers-color-scheme: dark){${rules(DARK)}}` : ''}
${isMoving ? `.comet{animation:comet 1.8s ease-in-out infinite}
@keyframes comet{0%{transform:translateX(-60px);opacity:0}30%{opacity:.55}100%{transform:translateX(0);opacity:0}}
.b-think circle{animation:bounce 1.1s ease-in-out infinite;transform-box:fill-box}.b-think circle:nth-child(2){animation-delay:.15s}.b-think circle:nth-child(3){animation-delay:.3s}
.b-spin{animation:spin 2.4s linear infinite;transform-box:fill-box;transform-origin:center}
.b-shake{animation:shake 1.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.b-pen{animation:scribble .9s ease-in-out infinite}
@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-1.5px)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes shake{0%,60%,100%{transform:rotate(0)}70%{transform:rotate(-12deg)}80%{transform:rotate(10deg)}90%{transform:rotate(-6deg)}}
@keyframes scribble{0%,100%{transform:translate(0,0)}50%{transform:translate(1.5px,-1px)}}` : ''}
${motion === 'off' ? '*{animation:none!important}' : ''}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}
</style>`

// The crab styles ride along only in drawings that hold a crab, to keep the pane small.
export const svg = (W: number, H: number, body: string, theme: Theme = 'follow', motion: 'full' | 'calm' | 'off' = 'full') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${css(theme, motion, /comet|b-think|b-spin|b-shake|b-pen/.test(body))}${!body.includes(' run"') ? '' : motion === 'off' ? CRAB_CSS.replace('.run .la', '.never .la') : CRAB_CSS}${body}</svg>`

export const xml = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const charEm = (ch: string): number => (/[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Zmw@%]/.test(ch) ? 0.72 : /\p{Extended_Pictographic}/u.test(ch) ? 1.1 : 0.56)
export const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)
export const fitText = (s: string, size: number, maxW: number): string => {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

// A line of text. cls: t (ink), s (muted), m (faint), fl (fail), ok.
export const text = (x: number, y: number, s: string, opts: { size?: number; cls?: string; weight?: number; anchor?: 'start' | 'end' | 'middle'; max?: number; mono?: boolean; fill?: string } = {}) => {
  const size = opts.size ?? 12
  const body = opts.max ? fitText(s, size, opts.max) : s
  return `<text class="${opts.cls ?? 't'}" x="${x}" y="${y}" font-family="${opts.mono ? MONO : FONT}" font-size="${size}"${opts.weight ? ` font-weight="${opts.weight}"` : ''}${opts.anchor ? ` text-anchor="${opts.anchor}"` : ''}${opts.fill ? ` style="fill:${opts.fill}"` : ''} font-variant-numeric="tabular-nums">${xml(body)}</text>`
}
export const label = (x: number, y: number, s: string, anchor: 'start' | 'end' = 'start') =>
  `<text class="s" x="${x}" y="${y}" font-family="${FONT}" font-size="10.5" letter-spacing=".8"${anchor === 'end' ? ' text-anchor="end"' : ''}>${xml(s.toUpperCase())}</text>`

// Lucide icons (lucide.dev, ISC license, v0.468.0): 24×24, 2px strokes, drawn at (x, y) scaled to size.
const ICONS: Record<string, string> = {
  run: '<polygon points="6 3 20 12 6 21 6 3"/>',
  search: '<circle cx="11" cy="11" r="8"/> <path d="m21 21-4.3-4.3"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/> <path d="M12 9v4"/> <path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  read: '<path d="M12 7v14"/> <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  think: '<g class="b-think"><circle fill="currentColor" cx="12" cy="12" r="1"/> <circle fill="currentColor" cx="19" cy="12" r="1"/> <circle fill="currentColor" cx="5" cy="12" r="1"/></g>',
  pen: '<g class="b-pen"><path d="M12 20h9"/> <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></g>',
  edit: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/> <path d="m15 5 4 4"/>',
  boot: '<g class="b-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></g>',
  stop: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  list: '<path d="M3 12h.01"/> <path d="M3 18h.01"/> <path d="M3 6h.01"/> <path d="M8 12h13"/> <path d="M8 18h13"/> <path d="M8 6h13"/>',
  gear: '<g class="b-spin"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/> <circle cx="12" cy="12" r="3"/></g>',
  branch: '<line x1="6" x2="6" y1="3" y2="15"/> <circle cx="18" cy="6" r="3"/> <circle cx="6" cy="18" r="3"/> <path d="M18 9a9 9 0 0 1-9 9"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  route: '<circle cx="6" cy="19" r="3"/> <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/> <circle cx="18" cy="5" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/> <polyline points="12 6 12 12 16 14"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  cycle: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/> <path d="M21 3v5h-5"/> <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/> <path d="M8 16H3v5"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/> <path d="M13 5v2"/> <path d="M13 17v2"/> <path d="M13 11v2"/>',
  web: '<circle cx="12" cy="12" r="10"/> <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/> <path d="M2 12h20"/>',
  spawn: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/> <circle cx="9" cy="7" r="4"/> <path d="M22 21v-2a4 4 0 0 0-3-3.87"/> <path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  todo: '<rect width="18" height="18" x="3" y="3" rx="2"/> <path d="m9 12 2 2 4-4"/>',
}
// Emoji the tracker records → drawn icon.
const EMOJI_ICON: Record<string, string> = {
  '📖': 'read', '✏️': 'edit', '📝': 'pen', '📓': 'edit', '🔍': 'search', '🗂️': 'list', '⚡': 'run', '🌐': 'web', '🔎': 'search',
  '🧬': 'spawn', '✅': 'check', '🎓': 'read', '🧰': 'list', '🔧': 'gear', '🧠': 'think', '💬': 'pen', '🌱': 'boot', '🚀': 'run',
  '💥': 'alert', '⏹️': 'stop', '📍': 'todo', '✓': 'check', '■': 'stop',
}
export const iconFor = (emojiOrName: string) => EMOJI_ICON[emojiOrName] ?? (ICONS[emojiOrName] ? emojiOrName : 'gear')
// Icons inherit the text colour of their class through currentColor.
export const iconInk = (name: string, x: number, y: number, size = 14, tone: 'ink' | 'muted' | 'ok' | 'fail' | 'warn' = 'muted') => {
  const cls = { ink: 'st-ink', muted: 'st-s', ok: 'st-ok', fail: 'st-fl', warn: 'st-wn' }[tone]
  return `<g transform="translate(${x},${y}) scale(${size / 24})" class="${cls}" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[iconFor(name)] ?? ''}</g>`
}

// ---------------------------------------------------------------- data marks
export type ProgKind = 'real' | 'est' | 'done' | 'halted'
// The horizontal progress bar: track, fill, and percent plus count at the right.
export const progress = (x: number, y: number, w: number, ratio: number, kind: ProgKind, color: string, count: string, live = false) => {
  const r = Math.max(0, Math.min(1, ratio))
  const pctW = 40, cntW = Math.max(52, textWidth(count, 11) + 6)
  const barW = Math.max(40, w - pctW - cntW - 12)
  const fw = Math.round(barW * r)
  const fill = kind === 'est'
    ? (fw > 0 ? `<rect x="${x}" y="${y}" width="${fw}" height="4" rx="2" style="fill:${color};opacity:.42"/>` : '')
    : `<rect x="${x}" y="${y}" width="${fw}" height="4" rx="2" ${kind === 'halted' ? 'class="m"' : kind === 'done' ? 'class="ok"' : `style="fill:${color}"`}/>`
  const comet = live && kind === 'real' && fw > 20 ? `<rect class="sf comet" x="${x + fw - 16}" y="${y}" width="16" height="4" opacity=".5"/>` : ''
  const stop = kind === 'halted' ? `<rect class="fl" x="${x + fw - 1}" y="${y - 4}" width="2" height="12" rx="1"/>` : ''
  const pct = `${kind === 'est' ? '~' : ''}${Math.round(r * 100)}%`
  return `<rect class="k" x="${x}" y="${y}" width="${barW}" height="4" rx="2"/>${fill}${comet}${stop}
${text(x + barW + 8 + pctW, y + 5, pct, { size: 12, weight: 600, anchor: 'end' })}
${text(x + barW + 12 + pctW, y + 5, count, { size: 11, cls: 's' })}`
}
// A thin meter for the status line.
export const meter = (x: number, y: number, w: number, ratio: number, tone: 'ink' | 'ok' | 'warn' | 'fail' = 'ink') =>
  `<rect class="k" x="${x}" y="${y}" width="${w}" height="4" rx="2"/><rect class="${tone === 'ink' ? 't' : tone === 'ok' ? 'ok' : tone === 'warn' ? 'wn' : 'fl'}" x="${x}" y="${y}" width="${Math.round(w * Math.max(0, Math.min(1, ratio)))}" height="4" rx="2"/>`
// A segmented gauge (Orbit's, made flat).
export const gauge = (x: number, y: number, w: number, ratio: number, segs = 20) => {
  const g = 2, sw = (w - g * (segs - 1)) / segs, on = Math.round(Math.max(0, Math.min(1, ratio)) * segs)
  return Array.from({ length: segs }, (_, i) => `<rect class="${i < on ? 't' : 'k'}" x="${(x + i * (sw + g)).toFixed(1)}" y="${y}" width="${sw.toFixed(1)}" height="6" rx="1"/>`).join('')
}
// A sparkline of recent values, area + line, in the scout blue.
export const spark = (x: number, y: number, w: number, h: number, values: number[], color = '#378add') => {
  if (values.length < 2) return `<line class="ln" x1="${x}" y1="${y + h}" x2="${x + w}" y2="${y + h}"/>`
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => `${(x + (i / (values.length - 1)) * w).toFixed(1)},${(y + h - (v / max) * h).toFixed(1)}`)
  return `<polygon points="${pts.join(' ')} ${x + w},${y + h} ${x},${y + h}" style="fill:${color};opacity:.14"/><polyline points="${pts.join(' ')}" fill="none" style="stroke:${color}" stroke-width="1.5"/>`
}
// A small rounded chip with optional icon; tone sets its fill.
export const chip = (x: number, y: number, s: string, tone: 'plain' | 'ok' | 'fail' | 'warn' | 'solidFail' = 'plain', iconName?: string) => {
  const w = textWidth(s, 10.5) + (iconName ? 26 : 12)
  const bg = { plain: 'tile', ok: 'tile', fail: 'ft', warn: 'tile', solidFail: 'fl' }[tone]
  const tc = tone === 'solidFail' ? '' : 't'
  return { w, svg: `<rect class="${bg}" x="${x}" y="${y}" width="${w}" height="16" rx="2"/>${iconName ? iconInk(iconName, x + 5, y + 2.5, 11, tone === 'ok' ? 'ok' : tone === 'fail' ? 'fail' : tone === 'warn' ? 'warn' : 'muted') : ''}<text class="${tc}" x="${x + (iconName ? 20 : 6)}" y="${y + 11.5}" font-family="${FONT}" font-size="10.5" font-weight="600"${tone === 'solidFail' ? ' style="fill:#fff"' : ''}>${xml(s)}</text>` }
}
// The status word next to a name.
export const statusWord = (x: number, y: number, word: string, tone: 'live' | 'fail' | 'ok' | 'muted', color: string) => {
  if (tone === 'ok') return { w: textWidth(word, 11) + 4, svg: text(x, y + 11.5, word, { size: 11, cls: 'ok', weight: 600 }) }
  if (tone === 'muted') return { w: textWidth(word, 11) + 4, svg: text(x, y + 11.5, word, { size: 11, cls: 's', weight: 600 }) }
  const w = textWidth(word, 10.5) + 12
  const bg = tone === 'fail' ? `<rect class="fl" x="${x}" y="${y}" width="${w}" height="16" rx="2"/>` : `<rect x="${x}" y="${y}" width="${w}" height="16" rx="2" style="fill:${color};opacity:.2"/>`
  return { w, svg: `${bg}<text class="${tone === 'fail' ? '' : 't'}" x="${x + 6}" y="${y + 11.5}" font-family="${FONT}" font-size="10.5" font-weight="600"${tone === 'fail' ? ' style="fill:#fff"' : ''}>${xml(word)}</text>` }
}
// The rounded avatar tile holding a crab.
export const avatar = (x: number, y: number, size: number, role: string, color: string, walking: boolean, dim = false, costume?: string) =>
  `<rect class="tile" x="${x}" y="${y}" width="${size}" height="${size}" rx="${size > 34 ? 8 : 6}"/><rect x="${x + .75}" y="${y + .75}" width="${size - 1.5}" height="${size - 1.5}" rx="${size > 34 ? 7.5 : 5.5}" fill="none" style="stroke:${color};opacity:.55" stroke-width="1.5"/>
<g transform="translate(${x + size * 0.14},${y + size * 0.17})">${crab(0, 0, costume ?? role, color, walking, (size * 0.72) / 30, dim)}</g>`
// A speech bubble with an animated icon, above a crab.
export const bubble = (x: number, y: number, kind: 'think' | 'gear' | 'pen' | 'alert' | 'check' | 'stop' | 'boot') => {
  const isFail = kind === 'alert'
  const ic = { think: 'think', gear: 'gear', pen: 'pen', alert: 'alert', check: 'check', stop: 'stop', boot: 'boot' }[kind]
  const tone = isFail ? '' : kind === 'check' ? 'st-ok' : 'st-ink'
  const body = isFail
    ? `<g class="b-shake">${(ICONS.alert ?? '').replaceAll('currentColor', '#fff')}</g>`
    : (ICONS[ic] ?? '')
  return `<g transform="translate(${x},${y})"><rect class="${isFail ? 'fl' : 'sf'}" x="0" y="0" width="20" height="15" rx="5"${isFail ? '' : ' style="stroke-width:1"'} /><rect class="${isFail ? 'fl' : 'sf'}" x="7" y="11" width="6" height="6" rx="1" transform="rotate(45 10 14)"/>${isFail ? '' : '<rect class="rim" x=".5" y=".5" width="19" height="14" rx="4.5" fill="none"/>'}
<g transform="translate(4.5,2) scale(.46)" fill="none" stroke="${isFail ? '#fff' : 'currentColor'}" class="${tone}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</g></g>`
}
export const hline = (x1: number, x2: number, y: number) => `<line class="ln" x1="${x1}" y1="${y + .5}" x2="${x2}" y2="${y + .5}"/>`
export const box = (x: number, y: number, w: number, h: number, cls = 'tile', rx = 8) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`
export const outline = (x: number, y: number, w: number, h: number, tone: 'fail' | 'ok' | 'rim' = 'fail', rx = 8) =>
  `<rect x="${x + .75}" y="${y + .75}" width="${w - 1.5}" height="${h - 1.5}" rx="${rx}" fill="none" class="${tone === 'fail' ? 'st-fl' : tone === 'ok' ? 'st-ok' : 'rim'}" stroke-width="1.5"/>`

// ---------------------------------------------------------------- fluid drawings
// The host gives no pane width, so a full-width drawing is 100% wide with no viewBox: its
// units stay CSS px (text never scales) and pieces are placed from the left in px, in
// percentages, or from the right edge with right(). Pass it to Svg with no width.
export const fsvg = (H: number, body: string, theme: Theme = 'follow', motion: 'full' | 'calm' | 'off' = 'full') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${H}">${css(theme, motion, /comet|b-think|b-spin|b-shake|b-pen/.test(body))}${!body.includes(' run"') ? '' : motion === 'off' ? CRAB_CSS.replace('.run .la', '.never .la') : CRAB_CSS}${body}</svg>`
// Content placed against the right edge: x and positions inside are negative, from the edge.
export const right = (body: string) => `<svg x="100%" y="0" width="1" height="100%" overflow="visible">${body}</svg>`
// A hairline across the full width.
export const fline = (y: number) => `<line class="ln" x1="0" y1="${y + 0.5}" x2="100%" y2="${y + 0.5}"/>`
// A rect from x px to the right edge less pad px.
export const frect = (x: number, y: number, pad: number, h: number, cls: string, rx = 2, extra = '') =>
  `<rect class="${cls}" x="${x}" y="${y}" height="${h}" rx="${rx}" style="width:calc(100% - ${x + pad}px)${extra}"/>`
// The progress bar across the free width: track, fill, percent and count at the right edge.
export const fprogress = (x: number, y: number, ratio: number, kind: ProgKind, color: string, count: string, live = false) => {
  const r = Math.max(0, Math.min(1, ratio))
  const pad = 128
  const fillStyle = kind === 'est' ? `fill:${color};opacity:.42` : kind === 'real' ? `fill:${color}` : ''
  const cls = kind === 'halted' ? 'm' : kind === 'done' ? 'ok' : ''
  const fill = r > 0 ? `<rect class="${cls}" x="${x}" y="${y}" height="4" rx="2" style="width:calc((100% - ${x + pad}px) * ${r.toFixed(3)});${fillStyle}"/>` : ''
  const pct = `${kind === 'est' ? '~' : ''}${Math.round(r * 100)}%`
  return frect(x, y, pad, 4, 'k') + fill
    + right(text(-78, y + 5, pct, { size: 12, weight: 600, anchor: 'end' }) + text(-72, y + 5, count, { size: 11, cls: 's', max: 70 }))
}

// A drawing laid out for width W, made full width: backgrounds and hairlines that span W
// stretch to the pane's edge, text anchored at the right edge sticks to it, text centred
// on W/2 stays centred. Everything else keeps its px place, so text never scales.
export const stretch = (W: number, body: string): string => {
  const near = (v: number, at: number, tol: number) => Math.abs(v - at) <= tol
  let out = body
    .replace(/x2="([\d.]+)"/g, (m, v) => (near(+v, W, 1.5) ? 'x2="100%"' : m))
    .replace(/<rect([^>]*?) width="([\d.]+)"/g, (m, attrs: string, v) => (near(+v, W, 2) ? `<rect${attrs} width="100%"` : m))
  out = out.replace(/<text([^>]*?) x="([\d.]+)"([^>]*?)>/g, (m, a: string, v, b: string) => {
    const attrs = a + b
    if (attrs.includes('text-anchor="end"') && +v >= W - 30) return `<text${a} x="100%" dx="${(+v - W).toFixed(1)}"${b}>`
    if (attrs.includes('text-anchor="middle"') && near(+v, W / 2, 1)) return `<text${a} x="50%"${b}>`
    return m
  })
  return out
}
export const wide = (W: number, H: number, body: string, theme: Theme = 'follow', motion: 'full' | 'calm' | 'off' = 'full') => fsvg(H, stretch(W, body), theme, motion)

// ---------------------------------------------------------------- terminal
export const barText = (ratio: number, width: number) => {
  const w = Math.max(6, width), full = Math.round(Math.max(0, Math.min(1, ratio)) * w)
  return '█'.repeat(full) + '░'.repeat(w - full)
}
export const estText = (ratio: number, width: number) => {
  const w = Math.max(6, width), full = Math.round(Math.max(0, Math.min(1, ratio)) * w)
  return '▒'.repeat(full) + '░'.repeat(w - full)
}

// ---------------------------------------------------------------- layout pieces
// Greedy word wrap by estimated width; a word longer than the line is cut with fitText.
export const wrap = (s: string, size: number, maxW: number): string[] => {
  const lines: string[] = []
  let cur = ''
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word
    if (textWidth(next, size) <= maxW || !cur) cur = textWidth(next, size) <= maxW ? next : fitText(word, size, maxW)
    else { lines.push(cur); cur = textWidth(word, size) <= maxW ? word : fitText(word, size, maxW) }
  }
  if (cur) lines.push(cur)
  return lines
}
// A wrapped paragraph; returns its markup and the height it took.
export const para = (x: number, y: number, s: string, maxW: number, opts: { size?: number; cls?: string; weight?: number; anchor?: 'start' | 'middle'; lh?: number; mono?: boolean } = {}) => {
  const size = opts.size ?? 12, lh = opts.lh ?? Math.round(size * 1.5)
  const lines = wrap(s, size, maxW)
  return { h: lines.length * lh, svg: lines.map((l, i) => text(x, y + i * lh, l, { size, cls: opts.cls, weight: opts.weight, anchor: opts.anchor, mono: opts.mono })).join('') }
}
// A section heading: a hairline above (except the first), the uppercase label, and an
// optional hint that wraps. Returns the markup and its height.
export const sectionHead = (W: number, title: string, hint: string | undefined, isFirst: boolean) => {
  const top = isFirst ? 0 : 14
  const h = hint ? para(0, top + 32, hint, W, { size: 11, cls: 's', lh: 15 }) : { h: 0, svg: '' }
  return {
    H: top + 20 + (hint ? h.h + 4 : 0),
    svg: (isFirst ? '' : hline(0, W, 4))
      + `<text class="s" x="0" y="${top + 14}" font-family="${FONT}" font-size="10.5" font-weight="700" letter-spacing=".8">${xml(title.toUpperCase())}</text>`
      + h.svg,
  }
}
// The left half of a settings row: the name, and under it a muted hint that wraps.
// Returns the markup and its height.
export const rowLabel = (w: number, name: string, hint?: string) => {
  if (!hint) return { H: 26, svg: text(0, 17, name, { size: 12.5, weight: 600, max: w }) }
  const p = para(0, 31, hint, w, { size: 11, cls: 's', lh: 15 })
  return { H: 21 + p.h, svg: text(0, 15, name, { size: 12.5, weight: 600, max: w }) + p.svg }
}
// What a tab shows with nothing in it: a crab, a title and two or three centred lines.
export const emptyCard = (W: number, title: string, body: string, role: string, color: string, walking: boolean) => {
  const bodyW = Math.min(W - 40, 280)
  const p = para(W / 2, 108, body, bodyW, { size: 11.5, cls: 's', anchor: 'middle', lh: 17 })
  const H = 108 + p.h + 10
  return {
    H,
    svg: box(0.5, 0.5, W - 1, H - 1, 'tile', 10) + `<rect class="rim" x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="10" fill="none"/>`
      + `<svg x="50%" y="0" width="1" height="1" overflow="visible"><g transform="translate(-22,18)">${crab(0, 0, role, color, walking, 1.45)}</g></svg>`
      + text(W / 2, 84, title, { size: 13.5, weight: 700, anchor: 'middle', max: W - 24 })
      + p.svg,
  }
}
