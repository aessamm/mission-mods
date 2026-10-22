#!/bin/sh
# commit-msg hook template: every commit names a GitHub issue (#123) or says no-issue.
# Install in a repo (from its root):
#   mkdir -p .githooks scripts
#   cp <skill>/scripts/commit-msg.sh .githooks/commit-msg
#   cp <skill>/scripts/check-commit-msg.mjs scripts/
#   git config core.hooksPath .githooks
# Keep the hook LF-only on Windows: add `.githooks/* text eol=lf` to .gitattributes.
exec node "$(git rev-parse --show-toplevel)/scripts/check-commit-msg.mjs" "$1"
