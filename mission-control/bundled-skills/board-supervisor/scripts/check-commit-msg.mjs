#!/usr/bin/env node
/**
 * commit-msg check: every commit names a GitHub issue (GitHub Issues are the task source),
 * or says `no-issue` on purpose. Run by the commit-msg hook (see commit-msg.sh) with the message file path.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// `#123`, `owner/repo#123`, `Refs #123`, `Closes #123` all contain `#<digits>` after a
// non-word character (or at the start), which keeps `abc#1` and colour codes out.
const ISSUE_REF = /(^|[^\w#])(?:[\w.-]+\/[\w.-]+)?#\d+\b/m;
const NO_ISSUE = /\bno-issue\b/i;
// Messages git or a rebase writes for us.
const AUTO_ALLOWED = /^(Merge |Revert "|fixup! |squash! |amend! )/;

export const USAGE =
  'commit message needs an issue ref or "no-issue", e.g. "fix(web): show empty state (#123)" or "chore: bump deps (no-issue)"';

/**
 * Drops what git leaves in the message file but never commits: the `git commit -v` diff
 * below the scissors line, and `# ` comment lines. A bare `#123` line is kept, since
 * `git commit -m` keeps it too.
 */
function stripComments(message) {
  const scissors = message.search(/^# -+ >8 -+$/m);
  const kept = scissors === -1 ? message : message.slice(0, scissors);
  return kept
    .split(/\r?\n/)
    .filter((line) => !/^#(\s|$)/.test(line))
    .join("\n");
}

/** True when the message may be committed. */
export function checkCommitMessage(message) {
  const body = stripComments(message).trim();
  if (AUTO_ALLOWED.test(body)) return true;
  return ISSUE_REF.test(body) || NO_ISSUE.test(body);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: check-commit-msg.mjs <commit-msg-file>");
    process.exit(2);
  }
  if (!checkCommitMessage(readFileSync(file, "utf8"))) {
    console.error(`commit-msg: ${USAGE}`);
    process.exit(1);
  }
}
