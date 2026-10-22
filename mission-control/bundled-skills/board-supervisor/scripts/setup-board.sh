#!/usr/bin/env bash
# Sets up a repo and a new GitHub Projects board for the board-supervisor way of working.
#
# usage: setup-board.sh [--dry-run] <owner> <repo> "<Project title>"
#   e.g. setup-board.sh octo-org my-app "My App"
#
# Needs: gh logged in with the `project` scope (the owner runs `gh auth refresh -s project` once).
# What it does:
#   1. Creates the standard labels (type/area/priority/owner-action/blocked/from-user).
#   2. Creates a new project owned by <owner> and linked to <owner>/<repo> (createProjectV2).
#   3. Sets its Status options to Todo / In progress / Review / Waiting on owner / Done
#      (updateProjectV2Field) and adds a Board view (createProjectV2View).
#   4. Prints the ids line for the project's CLAUDE.md and the steps that stay manual.
# --dry-run prints the steps and the GraphQL documents without calling GitHub.
# Safe to re-run for labels (--force). It refuses to create a second project with the same
# title linked to the same repo.
set -euo pipefail

DRY=0
if [ "${1:-}" = "--dry-run" ]; then DRY=1; shift; fi
OWNER=${1:?usage: setup-board.sh [--dry-run] <owner> <repo> \"<Project title>\"}
REPO=${2:?repo}
TITLE=${3:?project title}
R="$OWNER/$REPO"

LABELS='type:bug|d73a4a|Type: bug
type:feature|a2eeef|Type: feature
type:chore|cfd3d7|Type: chore
type:ops|5319e7|Type: ops
type:docs|0075ca|Type: docs
area:web|c5def5|Area: web
area:api|c5def5|Area: api
area:infra|c5def5|Area: infra
area:ops|c5def5|Area: ops
priority:p0|b60205|Do now: production at risk
priority:p1|d93f0b|Next up
priority:p2|fbca04|Later
owner-action|e99695|Needs the owner to act or decide
blocked|000000|Blocked by another issue or an external step
from-user|fbca04|Reported by a user'

# The board's columns. Colours are ProjectV2SingleSelectFieldOptionColor values.
STATUS_OPTIONS='[
  {name: "Todo", color: GRAY, description: "Not started"},
  {name: "In progress", color: YELLOW, description: "Being worked on"},
  {name: "Review", color: BLUE, description: "Done by the implementer, the supervisor is reviewing"},
  {name: "Waiting on owner", color: ORANGE, description: "Needs the owner"},
  {name: "Done", color: GREEN, description: "Landed or closed"}
]'

Q_IDS='query($owner: String!, $name: String!) {
  repositoryOwner(login: $owner) { id }
  repository(owner: $owner, name: $name) {
    id
    projectsV2(first: 50) { nodes { number title url closed } }
  }
}'

Q_CREATE='mutation($owner: ID!, $repo: ID!, $title: String!) {
  createProjectV2(input: {ownerId: $owner, repositoryId: $repo, title: $title}) {
    projectV2 {
      id number url
      field(name: "Status") { ... on ProjectV2SingleSelectField { id } }
    }
  }
}'

Q_STATUS='mutation($field: ID!) {
  updateProjectV2Field(input: {fieldId: $field, singleSelectOptions: '"$STATUS_OPTIONS"'}) {
    projectV2Field { ... on ProjectV2SingleSelectField { id options { id name } } }
  }
}'

# Only when a new project has no Status field (GitHub normally adds one).
Q_STATUS_NEW='mutation($project: ID!) {
  createProjectV2Field(input: {projectId: $project, dataType: SINGLE_SELECT, name: "Status", singleSelectOptions: '"$STATUS_OPTIONS"'}) {
    projectV2Field { ... on ProjectV2SingleSelectField { id options { id name } } }
  }
}'

Q_VIEW='mutation($project: ID!) {
  createProjectV2View(input: {projectId: $project, name: "Board", layout: BOARD_LAYOUT}) {
    projectV2View { id name }
  }
}'

manual_steps() {
  local url=$1
  cat <<EOF

Manual, in the web UI (no API for these):
  - $url/workflows: turn on "Auto-add to project" (filter: repo:$R is:issue,pr) and
    "Auto-add sub-issues to project"; check "Item closed" (Status: Done) and
    "Item reopened" (Status: Todo) are on. New projects start with only some of them on.
  - Views: the Board view groups by Status. Show Labels, Assignees and Linked pull requests on
    it, rename "View 1" to "Issues", and add a Roadmap view if the owner wants one.
EOF
}

if [ "$DRY" = 1 ]; then
  echo "== dry run: nothing is sent to GitHub"
  echo "== labels on $R"
  printf '%s\n' "$LABELS" | sed 's/^/  /'
  for doc in Q_IDS Q_CREATE Q_STATUS Q_STATUS_NEW Q_VIEW; do
    echo "-- graphql $doc"
    printf '%s\n' "${!doc}"
  done
  echo "-- end"
  manual_steps "https://github.com/<owner>/projects/<N>"
  exit 0
fi

command -v gh >/dev/null || { echo "setup-board: gh is not installed (https://cli.github.com)" >&2; exit 1; }

echo "== labels on $R"
while IFS='|' read -r name color desc; do
  gh label create "$name" -R "$R" --color "$color" --description "$desc" --force >/dev/null && echo "  $name"
done <<<"$LABELS"

echo "== look up $R"
# First line: the owner and repo ids; then one line per open project linked to the repo.
LOOKUP=$(gh api graphql -f query="$Q_IDS" -f owner="$OWNER" -f name="$REPO" \
  --jq '([.data.repositoryOwner.id, .data.repository.id] | @tsv),
        (.data.repository.projectsV2.nodes[] | select(.closed | not) | [.title, .url] | @tsv)' | tr -d '\r')
IFS=$'\t' read -r OWNER_ID REPO_ID <<<"$(head -n 1 <<<"$LOOKUP")"
if [ -z "${OWNER_ID:-}" ] || [ -z "${REPO_ID:-}" ]; then
  echo "setup-board: could not find $R (or gh cannot read it)" >&2
  exit 1
fi
SAME=""
while IFS=$'\t' read -r t u; do
  if [ "$t" = "$TITLE" ]; then SAME=$u; fi
done < <(tail -n +2 <<<"$LOOKUP")
if [ -n "$SAME" ]; then
  echo "setup-board: $R already has an open project called \"$TITLE\": $SAME" >&2
  echo "  Use it (gh project field-list <N> --owner $OWNER) or pick another title." >&2
  exit 1
fi

echo "== create the project"
IFS=$'\t' read -r PID NUM URL FIELD <<<"$(gh api graphql -f query="$Q_CREATE" -f owner="$OWNER_ID" -f repo="$REPO_ID" -f title="$TITLE" \
  --jq '.data.createProjectV2.projectV2 | [.id, (.number | tostring), .url, (.field.id // "")] | @tsv' | tr -d '\r')"
echo "  $URL (linked to $R)"

echo "== Status options"
OPTS_JQ='.projectV2Field | "Status field \(.id), " + ([.options[] | "\(.name) \(.id)"] | join(", "))'
if [ -n "${FIELD:-}" ]; then
  STATUS_LINE=$(gh api graphql -f query="$Q_STATUS" -f field="$FIELD" --jq ".data.updateProjectV2Field $OPTS_JQ" | tr -d '\r')
else
  STATUS_LINE=$(gh api graphql -f query="$Q_STATUS_NEW" -f project="$PID" --jq ".data.createProjectV2Field $OPTS_JQ" | tr -d '\r')
fi
echo "  Todo, In progress, Review, Waiting on owner, Done"

echo "== Board view"
if gh api graphql -f query="$Q_VIEW" -f project="$PID" >/dev/null 2>&1; then
  echo "  added"
else
  echo "  could not add it through the API; add a Board view by hand (below)"
fi

echo
echo "== ids for CLAUDE.md"
echo "Board: project $NUM ($URL), id $PID, $STATUS_LINE"

manual_steps "$URL"
