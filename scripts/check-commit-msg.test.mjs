// node --test scripts/
import assert from "node:assert/strict";
import { test } from "node:test";

import { checkCommitMessage } from "./check-commit-msg.mjs";

test("an issue ref or no-issue passes", () => {
  assert.equal(checkCommitMessage("feat(board): start a ticket (#1)"), true);
  assert.equal(checkCommitMessage("fix: tidy\n\nRefs aessamm/mission-mods#12"), true);
  assert.equal(checkCommitMessage("chore: bump (no-issue)"), true);
});

test("git's own messages pass", () => {
  assert.equal(checkCommitMessage("Merge branch 'claude/x'"), true);
  assert.equal(checkCommitMessage('Revert "feat: x"'), true);
  assert.equal(checkCommitMessage("fixup! feat: x"), true);
});

test("anything else is refused, and comments do not count", () => {
  assert.equal(checkCommitMessage("feat: something"), false);
  assert.equal(checkCommitMessage("feat: colour abc#1"), false);
  assert.equal(checkCommitMessage("feat: x\n# Please enter the commit message (#1)"), false);
});
