#!/usr/bin/env node
/**
 * board-cache: writes a repo's GitHub issues and their board Status to
 * `<repo>/.claude/board-cache.json`, in Mission Control's `mc.github-tasks.v1` shape, so the
 * Board tab can show them without the mod ever calling GitHub (#12).
 *
 *   node scripts/board-cache.mjs [--repo owner/name] [--project N --owner X] [--out path] [--timeout ms]
 *
 * The repo defaults to the git origin of the working folder, the project to the user project
 * linked to that repo. One paged `gh api graphql` query: open issues (100 a page) and, on the
 * first page, the 30 most recently closed. gh uses the owner's own login; no token is read,
 * written or printed. A network failure leaves the old cache and exits 0 with a warning.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SCHEMA = "mc.github-tasks.v1";
export const CACHE_FILE = ".claude/board-cache.json";
const NO_STATUS = "No status";
const DEFAULT_STATUSES = ["Todo", "In progress", "Review", "Waiting on owner", "Done"];
const CLOSED_RECENT = 30;
const MAX_OPEN_PAGES = 10;
// gh itself can take tens of seconds to start on a busy machine.
const DEFAULT_TIMEOUT_MS = 60_000;

export const QUERY = `
query($owner: String!, $name: String!, $after: String, $first: Boolean!,
      $hasProject: Boolean!, $projectOwner: String!, $projectNumber: Int!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    open: issues(first: 100, after: $after, states: OPEN,
                 orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { ...IssueFields }
    }
    closed: issues(first: ${CLOSED_RECENT}, states: CLOSED,
                   orderBy: { field: UPDATED_AT, direction: DESC }) @include(if: $first) {
      nodes { ...IssueFields }
    }
    projectsV2(first: 20) @include(if: $first) { nodes { ...ProjectFields } }
  }
  repositoryOwner(login: $projectOwner) @include(if: $hasProject) {
    ... on ProjectV2Owner { projectV2(number: $projectNumber) { ...ProjectFields } }
  }
}
fragment ProjectFields on ProjectV2 {
  number title url closed
  owner { __typename ... on User { login } ... on Organization { login } }
  field(name: "Status") { ... on ProjectV2SingleSelectField { options { name } } }
}
fragment IssueFields on Issue {
  number title state url
  labels(first: 20) { nodes { name } }
  assignees(first: 10) { nodes { login } }
  projectItems(first: 10) {
    nodes {
      project { number owner { ... on User { login } ... on Organization { login } } }
      status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
    }
  }
}`;

// ---------------------------------------------------------------- pure helpers

/** "owner/name" from a git remote URL (https or ssh, with or without .git), or null. */
export function repoFromRemote(remote) {
  const m = /github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(String(remote ?? "").trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** The command line, as { repo, project, owner, out, timeoutMs, help }; throws on a bad flag. */
export function parseArgs(argv) {
  const opts = { repo: null, project: null, owner: null, out: null, timeoutMs: DEFAULT_TIMEOUT_MS, help: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === "") throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === "--repo") opts.repo = value();
    else if (flag === "--project") opts.project = Number(value());
    else if (flag === "--owner") opts.owner = value();
    else if (flag === "--out") opts.out = value();
    else if (flag === "--timeout") opts.timeoutMs = Number(value());
    else if (flag === "-h" || flag === "--help") opts.help = true;
    else throw new Error(`unknown option ${flag}`);
  }
  if (opts.repo && !/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) throw new Error("--repo takes owner/name");
  if (opts.project !== null && !(Number.isInteger(opts.project) && opts.project > 0)) throw new Error("--project takes a project number");
  if (!(opts.timeoutMs > 0)) throw new Error("--timeout takes milliseconds");
  return opts;
}

/** The gh arguments for one page; `after` is the open-issues cursor, null on the first page. */
export function ghArgs(repo, project, after) {
  const [owner, name] = repo.split("/");
  const args = [
    "api", "graphql",
    "-f", `query=${QUERY}`,
    "-f", `owner=${owner}`,
    "-f", `name=${name}`,
    "-F", `first=${after ? "false" : "true"}`,
    "-F", `hasProject=${project ? "true" : "false"}`,
    "-f", `projectOwner=${project?.owner ?? owner}`,
    "-F", `projectNumber=${project?.number ?? 0}`,
  ];
  if (after) args.push("-f", `after=${after}`);
  return args;
}

const loginOf = (o) => o?.login ?? null;

/**
 * The board to read: the one named on the command line, else the open user project linked to
 * the repo (the repo owner's first, then any user's), else any linked open project.
 */
export function pickProject(firstPage, repoOwner, wanted) {
  const data = firstPage?.data ?? {};
  if (wanted) {
    const p = data.repositoryOwner?.projectV2;
    return p ? p : null;
  }
  const linked = (data.repository?.projectsV2?.nodes ?? []).filter((p) => p && !p.closed);
  const users = linked.filter((p) => p.owner?.__typename === "User");
  return (
    users.find((p) => loginOf(p.owner)?.toLowerCase() === repoOwner.toLowerCase()) ??
    users[0] ??
    linked[0] ??
    null
  );
}

/** Mission Control's cache from the query's pages. Pure: `now` is the fetch time in ms. */
export function shapeCache(pages, { repo, project: wanted = null, now = Date.now() } = {}) {
  const [head] = pages;
  const repoOwner = repo.split("/")[0];
  const project = pickProject(head, repoOwner, wanted);
  const owner = loginOf(project?.owner) ?? wanted?.owner ?? null;
  const onBoard = (item) =>
    project && item?.project?.number === project.number && (loginOf(item.project.owner) ?? owner) === owner;
  const nodes = [
    ...pages.flatMap((p) => p.data?.repository?.open?.nodes ?? []),
    ...(head?.data?.repository?.closed?.nodes ?? []),
  ];
  const seen = new Set();
  const issues = [];
  for (const n of nodes) {
    if (!n || typeof n.number !== "number" || seen.has(n.number)) continue;
    seen.add(n.number);
    const state = String(n.state).toLowerCase();
    const item = (n.projectItems?.nodes ?? []).find(onBoard);
    issues.push({
      number: n.number,
      title: n.title,
      state,
      url: n.url,
      labels: (n.labels?.nodes ?? []).map((l) => ({ name: l.name })),
      assignees: (n.assignees?.nodes ?? []).map((a) => a.login),
      status: item?.status?.name ?? (state === "closed" ? "Done" : NO_STATUS),
    });
  }
  const options = project?.field?.options?.map((o) => o.name) ?? DEFAULT_STATUSES;
  return {
    schema: SCHEMA,
    fetchedAt: new Date(now).toISOString(),
    repo: head?.data?.repository?.nameWithOwner ?? repo,
    project: project
      ? { owner, number: project.number, title: project.title ?? null, url: project.url ?? null }
      : null,
    statuses: options.includes(NO_STATUS) ? options : [...options, NO_STATUS],
    issues,
  };
}

/** One page's issues cursor, or a thrown error carrying GitHub's own message. */
export function nextCursor(page) {
  if (page?.errors?.length && !page.data?.repository) throw new Error(page.errors.map((e) => e.message).join("; "));
  if (!page?.data?.repository) throw new Error("no repository in the reply");
  const info = page.data.repository.open?.pageInfo;
  return info?.hasNextPage ? info.endCursor : null;
}

/** Keeps anything token-shaped out of what is printed. */
export function redact(text) {
  return String(text ?? "")
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted]")
    .replace(/(authorization:\s*)(bearer|token)\s+\S+/gi, "$1$2 [redacted]");
}

/** What went wrong with gh, by kind: scope (needs the project scope), network, auth, missing, other. */
export function classifyError(err) {
  const text = `${err?.stderr ?? ""}\n${err?.message ?? ""}`;
  if (err?.code === "ENOENT") return "missing";
  if (/INSUFFICIENT_SCOPES|read:project|required scopes|has not been granted the required scopes/i.test(text)) return "scope";
  if (err?.killed || err?.signal === "SIGTERM" || err?.code === "ETIMEDOUT" ||
      /timed out|timeout|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|network is unreachable|could not resolve host|error connecting|dial tcp|no such host|TLS handshake/i.test(text))
    return "network";
  if (/gh auth login|not logged in|authentication|HTTP 401|Bad credentials/i.test(text)) return "auth";
  return "other";
}

/** The .gitignore text with `entry` added, or null when it already covers it. Keeps the file's EOL. */
export function withIgnore(text, entry) {
  const src = text ?? "";
  const lines = src.split(/\r?\n/).map((l) => l.trim());
  const dir = entry.split("/")[0];
  const covered = [entry, `/${entry}`, `${dir}/`, `/${dir}/`, dir, `/${dir}`, `${dir}/*`, `/${dir}/*`, `**/${entry}`];
  if (lines.some((l) => covered.includes(l))) return null;
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const sep = src === "" || src.endsWith("\n") ? "" : eol;
  return `${src}${sep}${entry}${eol}`;
}

// ---------------------------------------------------------------- the run

async function run(cmd, args, { cwd, timeout }) {
  const { stdout } = await execFileAsync(cmd, args, {
    cwd, timeout, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function gitOut(args, cwd) {
  try {
    return (await run("git", args, { cwd, timeout: 5000 })).trim();
  } catch {
    return "";
  }
}

const USAGE = "usage: node scripts/board-cache.mjs [--repo owner/name] [--project N --owner X] [--out path] [--timeout ms]";

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`board-cache: ${err.message}\n${USAGE}`);
    return 2;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const root = (await gitOut(["rev-parse", "--show-toplevel"], cwd)) || cwd;
  const repo = opts.repo ?? repoFromRemote(await gitOut(["remote", "get-url", "origin"], root));
  if (!repo) {
    console.error("board-cache: no GitHub origin in this folder; pass --repo owner/name");
    return 2;
  }
  const project = opts.project ? { number: opts.project, owner: opts.owner ?? repo.split("/")[0] } : null;
  const out = path.resolve(root, opts.out ?? CACHE_FILE);

  const deadline = Date.now() + opts.timeoutMs;
  const pages = [];
  try {
    let after = null;
    do {
      const left = deadline - Date.now();
      if (left <= 0) throw Object.assign(new Error(`gh timed out after ${opts.timeoutMs} ms`), { code: "ETIMEDOUT" });
      const page = JSON.parse(await run("gh", ghArgs(repo, project, after), { cwd: root, timeout: left }));
      after = nextCursor(page);
      pages.push(page);
    } while (after && pages.length < MAX_OPEN_PAGES);
  } catch (err) {
    const kind = classifyError(err);
    // A killed gh has no stderr, and its message is the command line (the whole query).
    const why = err?.killed
      ? `gh did not answer within ${opts.timeoutMs} ms`
      : redact(String(err?.stderr || err?.message || err).trim().split(/\r?\n/)[0]).slice(0, 300);
    if (kind === "network") {
      console.warn(`board-cache: warning: could not reach GitHub (${why}); ${fs.existsSync(out) ? "the old cache stays" : "no cache written"}`);
      return 0;
    }
    if (kind === "scope") console.error("board-cache: gh's login cannot read project boards. Run: gh auth refresh -s read:project");
    else if (kind === "missing") console.error("board-cache: gh is not installed or not on PATH (https://cli.github.com)");
    else if (kind === "auth") console.error("board-cache: gh is not logged in. Run: gh auth login");
    else console.error(`board-cache: ${why}`);
    return 1;
  }

  const cache = shapeCache(pages, { repo, project });
  if (project && !cache.project) {
    console.error(`board-cache: project ${project.number} of ${project.owner} was not found (or gh cannot read it)`);
    return 1;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, out);

  // Keep the cache out of git when it lies inside the repo.
  const rel = path.relative(root, out).split(path.sep).join("/");
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    const ignore = path.join(root, ".gitignore");
    const before = fs.existsSync(ignore) ? fs.readFileSync(ignore, "utf8") : "";
    const after = withIgnore(before, rel);
    if (after !== null) fs.writeFileSync(ignore, after, "utf8");
  }

  const open = cache.issues.filter((i) => i.state === "open").length;
  const board = cache.project ? `${cache.project.title ?? "project"} #${cache.project.number}` : "no linked board";
  console.log(`board-cache: ${cache.repo}, ${open} open and ${cache.issues.length - open} recently closed issues, ${board} -> ${rel || out}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
