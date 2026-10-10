#!/usr/bin/env bash
# Mission Control installer for the Claude desktop app (macOS and Linux).
#
#   curl -fsSL https://raw.githubusercontent.com/aessamm/mission-mods/main/install/install.sh | bash
#
# Adds the Mission Mods marketplace and turns on mission-control@mission-mods in your Claude
# settings file. It merges into what is there, backs the file up before writing, and changes
# nothing when both entries are already set. Needs node or python3 to edit the JSON (no jq).
set -euo pipefail

MIN_VERSION="2.1.293"

say()  { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m%s\033[0m\n' "$*"; }
warn() { printf '  \033[33m%s\033[0m\n' "$*"; }
die()  { printf '\n  \033[31m%s\033[0m\n\n' "$*" >&2; exit 1; }

printf '\n  \033[36mMission Control installer\033[0m\n\n'

# 1. Where the settings file lives (CLAUDE_CONFIG_DIR wins over the default).
CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS="$CONFIG_DIR/settings.json"
say "Settings file: $SETTINGS"

if [ ! -f "$SETTINGS" ]; then
  mkdir -p "$CONFIG_DIR"
  printf '{}\n' > "$SETTINGS"
  say "No settings file yet, so created an empty one."
fi

# 2. A JSON tool: node, else python3. MISSION_MODS_JSON_TOOL=python3 forces python (for testing).
TOOL="${MISSION_MODS_JSON_TOOL:-}"
if [ -z "$TOOL" ]; then
  if command -v node >/dev/null 2>&1; then TOOL=node
  elif command -v python3 >/dev/null 2>&1; then TOOL=python3
  fi
fi
[ -n "$TOOL" ] || die "Mission Control needs node or python3 to edit your settings safely, and neither was found.
  Install one of them, or add the lines by hand (see 'Manual install' in the README):
  https://github.com/aessamm/mission-mods#manual-install"

# 3. Merge. The helper reads the file, writes the merged JSON to $TMP, and exits:
#    0 = changed, 3 = already set, 4 = not valid JSON, 5 = not an object / a section isn't an object.
TMP="$(mktemp "${TMPDIR:-/tmp}/mission-control-settings.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

set +e
if [ "$TOOL" = node ]; then
  node - "$SETTINGS" "$TMP" <<'NODE'
const fs = require('fs');
const [file, out] = process.argv.slice(2);
let raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
if (!raw.trim()) raw = '{}';
let data;
try { data = JSON.parse(raw); } catch { process.exit(4); }
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
if (!isObj(data)) process.exit(5);
for (const k of ['extraKnownMarketplaces', 'enabledPlugins']) {
  if (data[k] === undefined) data[k] = {};
  else if (!isObj(data[k])) { console.error(k); process.exit(5); }
}
const src = data.extraKnownMarketplaces['mission-mods']?.source;
if (!(isObj(src) && src.source === 'github' && src.repo === 'aessamm/mission-mods')) {
  data.extraKnownMarketplaces['mission-mods'] = { source: { source: 'github', repo: 'aessamm/mission-mods' } };
}
if (data.enabledPlugins['mission-control@mission-mods'] !== true) data.enabledPlugins['mission-control@mission-mods'] = true;
const parsedBefore = JSON.stringify(JSON.parse(raw));
if (JSON.stringify(data) === parsedBefore) process.exit(3);
fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
process.exit(0);
NODE
else
  "$TOOL" - "$SETTINGS" "$TMP" <<'PY'
import json, sys
file, out = sys.argv[1], sys.argv[2]
raw = open(file, encoding='utf-8-sig').read()
if not raw.strip():
    raw = '{}'
try:
    data = json.loads(raw)
except ValueError:
    sys.exit(4)
if not isinstance(data, dict):
    sys.exit(5)
original = json.dumps(json.loads(raw), sort_keys=False)
for k in ('extraKnownMarketplaces', 'enabledPlugins'):
    if k not in data:
        data[k] = {}
    elif not isinstance(data[k], dict):
        print(k, file=sys.stderr)
        sys.exit(5)
entry = data['extraKnownMarketplaces'].get('mission-mods')
src = entry.get('source') if isinstance(entry, dict) else None
if not (isinstance(src, dict) and src.get('source') == 'github' and src.get('repo') == 'aessamm/mission-mods'):
    data['extraKnownMarketplaces']['mission-mods'] = {'source': {'source': 'github', 'repo': 'aessamm/mission-mods'}}
if data['enabledPlugins'].get('mission-control@mission-mods') is not True:
    data['enabledPlugins']['mission-control@mission-mods'] = True
if json.dumps(data, sort_keys=False) == original:
    sys.exit(3)
with open(out, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')
sys.exit(0)
PY
fi
code=$?
set -e

case $code in
  0)
    BACKUP="$SETTINGS.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$SETTINGS" "$BACKUP"
    say "Backed up your settings to $BACKUP"
    cat "$TMP" > "$SETTINGS"
    ok "Added the Mission Mods marketplace and turned on Mission Control."
    ;;
  3) ok "Mission Control is already set up in your settings. Nothing changed." ;;
  4) die "Your settings file is not valid JSON, so nothing was changed.
  Fix it (or move it aside) and run this again: $SETTINGS" ;;
  5) die "Your settings file (or its extraKnownMarketplaces / enabledPlugins entry) is not a JSON object,
  so nothing was changed: $SETTINGS" ;;
  *) die "Something went wrong reading your settings (exit $code), and nothing was changed: $SETTINGS" ;;
esac

# 4. Version check, when the CLI is installed.
if command -v claude >/dev/null 2>&1; then
  have="$(claude --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
  if [ -n "$have" ]; then
    lowest="$(printf '%s\n%s\n' "$have" "$MIN_VERSION" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)"
    if [ "$lowest" = "$have" ] && [ "$have" != "$MIN_VERSION" ]; then
      warn "Claude Code $have is older than $MIN_VERSION, which Mission Control needs. Update Claude Code first."
    else
      say "Claude Code $have found."
    fi
  fi
else
  say "The claude command isn't installed. That's fine: just make sure the Claude desktop app is up to date (Claude Code $MIN_VERSION or newer)."
fi

printf '\n  \033[36mNext steps\033[0m\n'
say "1. Quit the Claude desktop app completely and open it again."
say "2. Start a new session in the Code tab."
say "3. Type /mission to open the panel."
printf '\n'
