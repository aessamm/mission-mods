// node --test scripts/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  classifyError, ghArgs, nextCursor, parseArgs, pickProject, redact, repoFromRemote, shapeCache, withIgnore,
} from "./board-cache.mjs";

// A real reply for aessamm/mission-mods (first page), trimmed to four open and two closed issues.
const PAGE = JSON.parse(readFileSync(new URL("./fixtures/board-cache-page.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-10-22T08:00:00Z");
const clone = (x) => JSON.parse(JSON.stringify(x));

test("a recorded reply becomes Mission Control's mc.github-tasks.v1 cache", () => {
  const cache = shapeCache([PAGE], { repo: "aessamm/mission-mods", now: NOW });
  assert.equal(cache.schema, "mc.github-tasks.v1");
  assert.equal(cache.fetchedAt, "2026-10-22T08:00:00.000Z");
  assert.equal(cache.repo, "aessamm/mission-mods");
  assert.deepEqual(cache.project, {
    owner: "aessamm", number: 5, title: "Mission Mods", url: "https://github.com/users/aessamm/projects/5",
  });
  assert.deepEqual(cache.statuses, ["Backlog", "Todo", "In progress", "Review", "Waiting on owner", "Done", "No status"]);
  assert.deepEqual(cache.issues.map((i) => [i.number, i.state, i.status]), [
    [13, "open", "Waiting on owner"],
    [11, "open", "Todo"],
    [12, "open", "In progress"],
    [14, "open", "No status"],
    [9, "closed", "Done"],
    [8, "closed", "Done"],
  ]);
  const first = cache.issues[0];
  assert.deepEqual(Object.keys(first), ["number", "title", "state", "url", "labels", "assignees", "status"]);
  assert.equal(first.url, "https://github.com/aessamm/mission-mods/issues/13");
  assert.ok(first.labels.every((l) => typeof l.name === "string" && Object.keys(l).length === 1));
  assert.ok(Array.isArray(first.assignees));
});

test("open issues from later pages join the first, and a number is listed once", () => {
  const second = clone(PAGE);
  second.data.repository.open.nodes = [
    { ...clone(PAGE.data.repository.open.nodes[0]), number: 99, title: "From page two" },
    clone(PAGE.data.repository.open.nodes[1]),
  ];
  delete second.data.repository.closed;
  delete second.data.repository.projectsV2;
  const cache = shapeCache([PAGE, second], { repo: "aessamm/mission-mods", now: NOW });
  assert.deepEqual(cache.issues.map((i) => i.number), [13, 11, 12, 14, 99, 9, 8]);
});

test("only the chosen board's Status counts; closed issues off the board read as Done", () => {
  const page = clone(PAGE);
  const [a] = page.data.repository.open.nodes;
  a.projectItems.nodes = [{ project: { number: 3, owner: { login: "someone" } }, status: { name: "Review" } }];
  const [c] = page.data.repository.closed.nodes;
  c.projectItems.nodes = [];
  const cache = shapeCache([page], { repo: "aessamm/mission-mods", now: NOW });
  assert.equal(cache.issues[0].status, "No status");
  assert.equal(cache.issues.find((i) => i.number === 9).status, "Done");
});

test("the board: the one asked for, else the repo owner's linked user project, else none", () => {
  const owned = (n, login, type = "User", closed = false) => ({ number: n, title: `P${n}`, url: "", closed, owner: { __typename: type, login } });
  const page = (projects, asked) => ({ data: { repository: { projectsV2: { nodes: projects } }, ...(asked ? { repositoryOwner: { projectV2: asked } } : {}) } });
  assert.equal(pickProject(page([owned(1, "org", "Organization"), owned(2, "other"), owned(5, "aessamm")]), "aessamm", null).number, 5);
  assert.equal(pickProject(page([owned(1, "org", "Organization"), owned(2, "other")]), "aessamm", null).number, 2);
  assert.equal(pickProject(page([owned(5, "aessamm", "User", true), owned(1, "org", "Organization")]), "aessamm", null).number, 1);
  assert.equal(pickProject(page([]), "aessamm", null), null);
  assert.equal(pickProject(page([owned(5, "aessamm")], owned(7, "aessamm")), "aessamm", { number: 7, owner: "aessamm" }).number, 7);
  assert.equal(pickProject(page([owned(5, "aessamm")]), "aessamm", { number: 7, owner: "aessamm" }), null);

  const none = clone(PAGE);
  none.data.repository.projectsV2.nodes = [];
  const cache = shapeCache([none], { repo: "aessamm/mission-mods", now: NOW });
  assert.equal(cache.project, null);
  assert.deepEqual(cache.statuses, ["Todo", "In progress", "Review", "Waiting on owner", "Done", "No status"]);
  assert.equal(cache.issues[0].status, "No status");
});

test("the gh call: the first page asks for closed issues and projects, later pages only for open ones", () => {
  const first = ghArgs("aessamm/mission-mods", null, null);
  assert.deepEqual(first.slice(0, 2), ["api", "graphql"]);
  assert.ok(first.includes("owner=aessamm") && first.includes("name=mission-mods"));
  assert.ok(first.includes("first=true") && first.includes("hasProject=false"));
  assert.ok(!first.some((a) => a.startsWith("after=")));
  const later = ghArgs("aessamm/mission-mods", { number: 5, owner: "aessamm" }, "CURSOR");
  assert.ok(later.includes("first=false") && later.includes("hasProject=true") && later.includes("projectNumber=5"));
  assert.ok(later.includes("after=CURSOR"));
  assert.equal(nextCursor(PAGE), null);
  const more = clone(PAGE);
  more.data.repository.open.pageInfo = { hasNextPage: true, endCursor: "NEXT" };
  assert.equal(nextCursor(more), "NEXT");
  assert.throws(() => nextCursor({ errors: [{ message: "Could not resolve to a Repository" }] }), /Could not resolve/);
});

test("options, remotes and the .gitignore line", () => {
  assert.deepEqual(parseArgs([]), { repo: null, project: null, owner: null, out: null, timeoutMs: 60000, help: false });
  assert.deepEqual(parseArgs(["--repo", "a/b", "--project=5", "--owner", "x", "--out", "o.json", "--timeout", "500"]),
    { repo: "a/b", project: 5, owner: "x", out: "o.json", timeoutMs: 500, help: false });
  assert.throws(() => parseArgs(["--repo", "nope"]), /owner\/name/);
  assert.throws(() => parseArgs(["--project", "x"]), /project number/);
  assert.throws(() => parseArgs(["--what"]), /unknown option/);
  assert.equal(repoFromRemote("https://github.com/aessamm/mission-mods.git"), "aessamm/mission-mods");
  assert.equal(repoFromRemote("git@github.com:aessamm/mos.git\n"), "aessamm/mos");
  assert.equal(repoFromRemote("https://gitlab.com/a/b.git"), null);
  assert.equal(withIgnore("node_modules/\r\n*.log\r\n", ".claude/board-cache.json"), "node_modules/\r\n*.log\r\n.claude/board-cache.json\r\n");
  assert.equal(withIgnore("dist", ".claude/board-cache.json"), "dist\n.claude/board-cache.json\n");
  assert.equal(withIgnore("", ".claude/board-cache.json"), ".claude/board-cache.json\n");
  assert.equal(withIgnore("x\n.claude/\n", ".claude/board-cache.json"), null);
  assert.equal(withIgnore("/.claude/board-cache.json\n", ".claude/board-cache.json"), null);
});

test("errors are told apart, and nothing token-shaped is printed", () => {
  assert.equal(classifyError({ stderr: "GraphQL: Your token has not been granted the required scopes to execute this query. The 'read:project' scope is required" }), "scope");
  assert.equal(classifyError({ stderr: "INSUFFICIENT_SCOPES" }), "scope");
  assert.equal(classifyError({ stderr: 'error connecting to api.github.com' }), "network");
  assert.equal(classifyError({ killed: true, signal: "SIGTERM", message: "Command failed" }), "network");
  assert.equal(classifyError({ code: "ETIMEDOUT", message: "gh timed out after 20000 ms" }), "network");
  assert.equal(classifyError({ code: "ENOENT", message: "spawn gh ENOENT" }), "missing");
  assert.equal(classifyError({ stderr: "To get started with GitHub CLI, please run:  gh auth login" }), "auth");
  assert.equal(classifyError({ stderr: "GraphQL: Could not resolve to a Repository" }), "other");
  const token = "ghp_" + "a".repeat(36);
  assert.equal(redact(`bad credentials for ${token}`), "bad credentials for [redacted]");
  assert.equal(redact("Authorization: Bearer abc.def"), "Authorization: Bearer [redacted]");
});
