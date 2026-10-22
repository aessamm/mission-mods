// node --test scripts/check-jsx-names.test.mjs
// The plugin directory blocks a .jsx/.tsx file that uses `h` or `Fragment` as a name of its
// own (a variable, parameter, import or value): JSX compiles to calls of `h`, so such a name
// would silently change every element in the file. `claude plugin validate` does not catch it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "mission-control");
const NAME = String.raw`\b(const|let|var|function|import)\s+[{\s\w,]*\b(h|Fragment)\b|[(,]\s*(h|Fragment)\s*[,):=]|\b(h|Fragment)\s*=>|\b(h|Fragment)\.\w|=\s*(h|Fragment)\b`;

function jsxFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsxFiles(p, out);
    else if (/\.(jsx|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// A line's code without its // comment and without the text of its strings.
const codeOf = (line) => line.replace(/\/\/.*$/, "").replace(/(['"`])(?:\\.|(?!\1).)*\1/g, "''");

export function offenders(src) {
  const re = new RegExp(NAME);
  return src.split(/\r?\n/).map((l, i) => [i + 1, l]).filter(([, l]) => re.test(codeOf(l)));
}

test("the pattern finds a declared h and leaves strings and calls alone", () => {
  assert.equal(offenders("const h = 1").length, 1);
  assert.equal(offenders("list.map(h => h.x)").length, 1);
  assert.equal(offenders("import { Fragment } from 'x'").length, 1);
  assert.equal(offenders("const s = `${n}h ago`; git(['--format=%h'])").length, 0);
  assert.equal(offenders("// const h = 1").length, 0);
});

test("no .jsx/.tsx file in the mod uses h or Fragment as a name", () => {
  const found = [];
  for (const f of jsxFiles(ROOT)) {
    for (const [n, l] of offenders(fs.readFileSync(f, "utf8"))) found.push(`${path.relative(ROOT, f)}:${n}: ${l.trim()}`);
  }
  assert.deepEqual(found, []);
});
