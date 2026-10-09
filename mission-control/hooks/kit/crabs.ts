// Pixel crab characters, one costume per role, drawn as SVG for the desktop.
//
// The crab body, the explore/heavy/careful/medium/light/fable costumes and their
// animations come from savvy-progress by johnnyvizz (MIT License, Copyright (c)
// 2026 johnnyvizz, https://github.com/johnnyvizz/claude-kit), itself after Pixel
// Clawd from DockCrab. The other costumes are Agent HQ's own, in the same style.

const CLAY = '#D97757'
const INK = '#1F1E1D'

// `cls` puts a pixel in a named group: `bd` (the default) is the body and its
// costume, `la`/`lb` the leg pairs, anything else a prop with its own motion.
type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string): void =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

// `armCls` lets a raised claw travel with the prop it holds.
const crabBody = (f: Fill, armFront = 0, armCls?: string): void => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14 + armFront, 4, 4, CLAY, armCls)
  f(9, 12, 2, 2, INK)
  f(19, 12, 2, 2, INK)
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

// Pure CSS, run by the compositor: no redraws. Every working crab walks; each
// costume adds its prop's own motion on top.
export const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
@keyframes blink{50%{opacity:.15}}@keyframes twist{50%{transform:rotate(-35deg)}}
.c-fable.run{animation:float 1s ease-in-out infinite}
.c-fable.run .la,.c-fable.run .lb,.c-fable.run .bd{animation:none}
.c-fable.run .ant{animation:blink 1s steps(1) infinite}
.c-fable.run .star{animation:blink .5s steps(1) infinite -.25s}
@keyframes float{50%{transform:translateY(-2px)}}
.c-heavy.run .it{animation:scan 1s steps(1) infinite}
.c-heavy.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-careful.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
.c-medium.run .pan{transform-origin:0 50%;animation:tilt 1s ease-in-out infinite}
.c-medium.run .egg{animation:flip 1s ease-in-out infinite}
@keyframes tilt{20%,40%{transform:rotate(-12deg)}}@keyframes flip{30%{transform:translateY(-5px) scaleY(-1)}60%{transform:translateY(0)}}
.c-light.run .la{animation-duration:.25s}.c-light.run .lb{animation-duration:.25s;animation-delay:-.125s}
.c-light.run .flag{transform-origin:0 50%;animation:wave .25s steps(1) infinite}
@keyframes wave{50%{transform:skewY(-12deg) scaleX(.85)}}
.c-explore.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
.c-debugger.run .lamp{animation:blink .5s steps(1) infinite}
.c-debugger.run .it{animation:scan 1s steps(1) infinite}
.c-tester.run .bub{animation:rise 1s steps(4) infinite}.c-tester.run .bub2{animation:rise 1s steps(4) infinite -.5s}
@keyframes rise{to{transform:translateY(-4px);opacity:0}}
.c-scribe.run .it{transform-origin:0 100%;animation:twist .5s ease-in-out infinite}
.c-researcher.run .pg{transform-origin:0 50%;animation:page 1s steps(2) infinite}
@keyframes page{50%{transform:scaleX(-1)}}
.c-designer.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
.c-guardian.run .gl{animation:blink 1s steps(1) infinite}
.c-analyst.run .b1,.c-analyst.run .b2,.c-analyst.run .b3{transform-origin:50% 100%;animation:grow 1s ease-in-out infinite}
.c-analyst.run .b2{animation-delay:-.33s}.c-analyst.run .b3{animation-delay:-.66s}
@keyframes grow{50%{transform:scaleY(.4)}}
.c-guide.run .nd{animation:blink .5s steps(1) infinite}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`

const COSTUMES: Record<string, (f: Fill, t: string) => void> = {
  // Architect: astronaut in a glass dome; floats instead of walking, the antenna and the star blink.
  fable: (f, t) => {
    crabBody(f)
    f(6, 7, 18, 1, '#E6E8EE'); f(5, 8, 1, 14, '#E6E8EE'); f(24, 8, 1, 14, '#E6E8EE'); f(6, 22, 18, 1, '#C9CCD2')
    f(6, 8, 18, 14, 'rgba(169,214,245,.32)'); f(8, 9, 2, 1, '#fff'); f(8, 10, 1, 2, '#fff')
    f(14, 4, 2, 3, '#C9CCD2'); f(14, 2, 2, 2, t, 'ant'); f(13, 18, 4, 2, t)
    f(27, 3, 1, 3, '#F5C542', 'star'); f(26, 4, 3, 1, '#F5C542', 'star')
  },
  // Reviewer: detective with a deerstalker; the magnifier sweeps and glints.
  heavy: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
    f(6, 9, 18, 1, t)
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, '#7A4A26', 'it'); f(24, 2, 1, 1, '#fff', 'gl')
  },
  // Builder: engineer in a hard hat; the wrench turns a bolt.
  careful: (f, t) => {
    crabBody(f)
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    f(13, 5, 4, 2, t)
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it')
  },
  // Refactorer: chef; tosses the omelette.
  medium: (f, t) => {
    crabBody(f, -4, 'pan')
    stamp(f, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: t, d: '#B45F43' })
    f(22, 8, 7, 2, '#4A4A48', 'pan'); f(26, 10, 1, 1, '#4A4A48', 'pan'); f(24, 7, 3, 1, '#F5B731', 'egg')
  },
  // Operator: racer in a helmet; runs at double pace, the checkered flag flutters.
  light: (f, t) => {
    crabBody(f, -4)
    stamp(f, 6, 5, ['....rrrrrrrrrr....', '..rrrrrrwwrrrrrr..', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.kkkkkkkkkkkkkkkkr'], { r: t, w: '#F8F6F1', k: INK })
    f(25, 1, 1, 9, '#8E929A')
    stamp(f, 26, 1, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: INK }, 'flag')
  },
  // Scout: pirate scouting the code; the cutlass fences.
  explore: f => {
    crabBody(f)
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    f(7, 11, 11, 1, INK); f(18, 11, 4, 3, INK)
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, '#7A4A26', 'it')
  },
  // Debugger: headlamp that flickers and a bug caught in the claw, squirming.
  debugger: (f, t) => {
    crabBody(f, -4, 'it')
    f(7, 8, 16, 2, '#3A3A3C'); f(7, 9, 16, 1, t)
    f(13, 5, 4, 3, '#F5C542', 'lamp'); f(14, 6, 2, 1, '#fff', 'lamp')
    stamp(f, 23, 6, ['g..g', '.gg.', 'gggg', '.gg.'], { g: '#3B7D3A' }, 'it')
  },
  // Tester: lab goggles and a bubbling flask.
  tester: (f, t) => {
    crabBody(f, -4)
    f(7, 12, 16, 1, '#3A3A3C')
    f(8, 11, 4, 4, '#3A3A3C'); f(18, 11, 4, 4, '#3A3A3C')
    f(9, 12, 2, 2, 'rgba(169,214,245,.95)'); f(19, 12, 2, 2, 'rgba(169,214,245,.95)')
    stamp(f, 23, 3, ['.ww.', '.ww.', 'w..w', 'wggw', 'wggw', '.ww.'], { w: '#C9CCD2', g: t })
    f(24, 1, 1, 1, t, 'bub'); f(25, 0, 1, 1, t, 'bub2')
  },
  // Scribe: a quill that writes in the air, a page in the other claw.
  scribe: f => {
    crabBody(f, -4, 'it')
    stamp(f, 24, 1, ['...f', '..ff', '.ff.', '.f..', 'k...'], { f: '#F8F6F1', k: INK }, 'it')
    f(24, 6, 1, 4, '#8E929A', 'it')
    f(0, 11, 3, 6, '#F8F6F1'); f(0, 12, 2, 1, '#9a9a96'); f(0, 14, 2, 1, '#9a9a96')
  },
  // Researcher: round glasses over a book whose page turns.
  researcher: f => {
    crabBody(f)
    stamp(f, 8, 11, ['kkkk......kkkk', 'k..kkkkkkkk..k', 'kkkk......kkkk'], { k: INK })
    f(10, 17, 10, 4, '#7A4A26'); f(11, 17, 4, 3, '#F8F6F1'); f(15, 17, 4, 3, '#F8F6F1', 'pg')
  },
  // Designer: beret and a paintbrush that sweeps.
  designer: (f, t) => {
    crabBody(f, -4, 'it')
    f(13, 5, 2, 1, '#9C2A3A')
    stamp(f, 7, 6, ['....bbbbbbb.....', '..bbbbbbbbbbbb..', '.bbbbbbbbbbbbbb.', 'bbbbbbbbbbbbbbbb'], { b: '#9C2A3A' })
    f(24, 3, 1, 7, '#7A4A26', 'it'); f(23, 1, 3, 2, t, 'it')
  },
  // Guardian: knight's helmet with a plume, a shield whose rim glints.
  guardian: (f, t) => {
    crabBody(f)
    f(14, 1, 2, 3, t)
    stamp(f, 6, 4, ['.....ssssssss.....', '...ssssssssssss...', '..ssssssssssssss..', '..ssssppppppssss..', '.ssssssssssssssss.', 'ssssssssssssssssss'], { s: '#9AA0A8', p: t })
    stamp(f, 0, 11, ['sssss', 'sttts', 'sttts', '.sss.', '..s..'], { s: '#9AA0A8', t })
    f(1, 12, 1, 1, '#fff', 'gl')
  },
  // Analyst: a cap and a bar chart that keeps changing.
  analyst: (f, t) => {
    crabBody(f, -4)
    f(8, 6, 14, 4, '#3A4A5E'); f(8, 8, 14, 1, t); f(16, 9, 9, 1, '#3A4A5E')
    f(25, 16, 1, 6, t, 'b1'); f(27, 12, 1, 10, t, 'b2'); f(29, 14, 1, 8, t, 'b3')
  },
  // Guide: explorer's pith hat and a compass whose needle flickers.
  guide: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 4, ['.....kkkkkkkk.....', '...kkkkkkkkkkkk...', '...kkkkkkkkkkkk...', '...tttttttttttt...', 'kkkkkkkkkkkkkkkkkk'], { k: '#C8B27A', t })
    stamp(f, 23, 5, ['.ggg.', 'g...g', 'g...g', 'g...g', '.ggg.'], { g: '#C9A23A' }, 'it')
    f(25, 6, 1, 2, '#D0453F', 'nd'); f(25, 8, 1, 1, '#3A3A3C', 'it')
  },
  other: f => crabBody(f),
}

// Roles that wear one of savvy-progress's costumes.
const BORROWED: Record<string, string> = {
  scout: 'explore', reviewer: 'heavy', builder: 'careful', refactorer: 'medium', operator: 'light', architect: 'fable',
}

export const costumeOf = (role: string): string => {
  const key = role.toLowerCase()
  return BORROWED[key] ?? (key in COSTUMES ? key : 'other')
}

// Body and props nest inside `bd` so a prop rides the bob and adds its own motion;
// legs stay outside it and step on their own. Drawn on a 30×28 grid, then scaled.
export const crab = (x: number, y: number, role: string, accent: string, isWalking: boolean, scale = 1.1, dim = false): string => {
  const costume = costumeOf(role)
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  ;(COSTUMES[costume] ?? ((g: Fill) => crabBody(g)))(f, accent)
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`
  return `<g transform="translate(${x},${y}) scale(${scale})" opacity="${dim ? 0.45 : 1}" shape-rendering="crispEdges"><g class="c-${costume}${isWalking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g>`
}
