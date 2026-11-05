#!/usr/bin/env bash
# merge-when-green.sh <pr> <sha> [owner/repo]
#
# Waits for every check on PR <pr> to finish, then queues the merge only if at least one check exists,
# every check passed or was skipped, and the PR head is still exactly <sha>. Then follows the merge
# queue until the PR merges, drops out or the wait runs out. The repo defaults to the current
# checkout's GitHub repo (gh repo view). Tests: merge-when-green.test.sh, next to this script.
#
# Exit codes (distinct from gh's own 1, 2, 4 and 8):
#   0   merged
#   10  head moved (the PR head is no longer <sha>)
#   11  checks not green: one failed, was cancelled or is in another non-pass state, or there are none
#   12  merge failed (the merge command failed, or the PR closed without merging)
#   13  dropped from the merge queue (auto-merge is disabled before exiting)
#   14  timed out waiting for checks or for the merge queue
#   15  a gh call failed
#   16  usage error
set -euo pipefail

readonly EXIT_HEAD_MOVED=10 EXIT_NOT_GREEN=11 EXIT_MERGE_FAILED=12 EXIT_DROPPED=13
readonly EXIT_TIMED_OUT=14 EXIT_GH=15 EXIT_USAGE=16

# Wait limits. Checks: 60 polls x 60 s. Queue: 120 polls x 30 s (the queue's own check timeout is 60 min).
readonly CHECKS_MAX_POLLS=60 CHECKS_POLL_SECONDS=60
readonly QUEUE_MAX_POLLS=120 QUEUE_POLL_SECONDS=30
# GitHub briefly removes and re-adds entries when a group ahead fails: confirm a drop with 3 more readings.
readonly DROP_CONFIRM_READS=3 DROP_CONFIRM_SECONDS=40

usage() {
  echo "usage: merge-when-green.sh <pr> <sha> [owner/repo]${1:+ ($1)}" >&2
  exit "$EXIT_USAGE"
}

# Runs gh and keeps its stdout in $gh_out. Any gh failure ends the script with EXIT_GH.
gh_out=""
gh_read() {
  if ! gh_out="$(gh "$@")"; then
    echo "GH ERROR: gh $1 $2 failed" >&2
    exit "$EXIT_GH"
  fi
}

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ] || [ -z "$1" ] || [ -z "$2" ]; then
  usage
fi
pr="$1"
sha="$2"
repo="${3:-}"
if [ -z "$repo" ]; then
  gh_read repo view --json nameWithOwner --jq .nameWithOwner
  repo="$gh_out"
fi
owner="${repo%%/*}"
name="${repo#*/}"
if [ -z "$owner" ] || [ -z "$name" ] || [ "$owner" = "$repo" ]; then
  usage "bad repo: $repo"
fi

check_head() {
  gh_read pr view "$pr" --repo "$repo" --json headRefOid --jq .headRefOid
  if [ "$gh_out" != "$sha" ]; then
    echo "HEAD MOVED $gh_out"
    exit "$EXIT_HEAD_MOVED"
  fi
}

# 1. Wait until no check is pending, with the head unchanged throughout. Every check is read in one
#    call: total, pending count, and the non-pending checks that are not pass or skipping.
#    gh reports zero checks as an error ("no checks reported on the '<branch>' branch"): that counts as none.
summary='"\(length) \([.[]|select(.bucket=="pending")]|length) \([.[]|select(.bucket!="pass" and .bucket!="skipping" and .bucket!="pending")|"\(.name)=\(.bucket)"]|join(", "))"'
read_checks() {
  local errfile err rc=0
  errfile="$(mktemp)"
  gh_out="$(gh pr checks "$pr" --repo "$repo" --json name,bucket --jq "$summary" 2>"$errfile")" || rc=$?
  err="$(cat "$errfile")"
  rm -f "$errfile"
  if [ "$rc" != 0 ]; then
    if [[ "$err" == *"no checks reported"* ]]; then
      gh_out="0 0 "
    else
      echo "$err" >&2
      echo "GH ERROR: gh pr checks failed" >&2
      exit "$EXIT_GH"
    fi
  fi
  total="" pending="" bad=""
  read -r total pending bad <<<"$gh_out" || true
  case "$total$pending" in
    "" | *[!0-9]*)
      echo "GH ERROR: unexpected gh pr checks output: $gh_out" >&2
      exit "$EXIT_GH"
      ;;
  esac
}
polls=0
while :; do
  check_head
  read_checks
  if [ "$pending" = 0 ]; then
    break
  fi
  polls=$((polls + 1))
  if [ "$polls" -ge "$CHECKS_MAX_POLLS" ]; then
    echo "TIMED OUT: $pending check(s) still pending"
    exit "$EXIT_TIMED_OUT"
  fi
  sleep "$CHECKS_POLL_SECONDS"
done

# 2. Refuse unless at least one check exists and every check passed or was skipped.
if [ "$total" = 0 ]; then
  echo "NOT GREEN: no checks reported"
  exit "$EXIT_NOT_GREEN"
fi
if [ -n "$bad" ]; then
  echo "NOT GREEN: $bad"
  exit "$EXIT_NOT_GREEN"
fi

# 3. Re-read the head, then queue the merge bound to it.
check_head
if ! gh pr merge "$pr" --repo "$repo" --match-head-commit "$sha"; then
  check_head
  echo "MERGE COMMAND FAILED"
  exit "$EXIT_MERGE_FAILED"
fi
echo "QUEUED $pr at $sha"

# 4. Follow the merge queue. The $ names are GraphQL variables, not shell ones.
# shellcheck disable=SC2016
query='query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){state mergeQueueEntry{state}}}}'
queue_state() {
  gh_read api graphql -f query="$query" -f owner="$owner" -f name="$name" -F n="$pr" \
    --jq '.data.repository.pullRequest | .state + " " + (.mergeQueueEntry.state // "none")'
  state="$gh_out"
}
polls=0
while :; do
  queue_state
  if [ "$state" = "OPEN none" ]; then
    gone=1
    for ((i = 0; i < DROP_CONFIRM_READS; i++)); do
      sleep "$DROP_CONFIRM_SECONDS"
      queue_state
      if [ "$state" != "OPEN none" ]; then
        gone=0
        break
      fi
    done
    if [ "$gone" = 1 ]; then
      echo "DROPPED FROM MERGE QUEUE (merge-group CI failed?)"
      if ! gh pr merge "$pr" --repo "$repo" --disable-auto; then
        echo "WARNING: could not disable auto-merge on $pr" >&2
      fi
      exit "$EXIT_DROPPED"
    fi
  fi
  case "$state" in
    OPEN*) ;;
    *) break ;;
  esac
  polls=$((polls + 1))
  if [ "$polls" -ge "$QUEUE_MAX_POLLS" ]; then
    echo "TIMED OUT: $pr still in the merge queue ($state)"
    exit "$EXIT_TIMED_OUT"
  fi
  sleep "$QUEUE_POLL_SECONDS"
done

gh_read pr view "$pr" --repo "$repo" --json state,mergeCommit --jq '.state+" "+(.mergeCommit.oid//"")'
echo "$gh_out"
case "$gh_out" in
  MERGED*) exit 0 ;;
  *)
    echo "NOT MERGED"
    exit "$EXIT_MERGE_FAILED"
    ;;
esac
