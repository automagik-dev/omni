#!/usr/bin/env bash
# merge-when-green.sh <pr> <sha> [owner/repo]
#
# Waits for every check on PR <pr> to finish, then queues the merge only if none failed and the
# PR head is still exactly <sha>. Then follows the merge queue until the PR merges or drops out.
# The repo defaults to the current checkout's GitHub repo (gh repo view).
#
# Exit codes:
#   0  merged
#   1  usage error, or a gh call that must succeed failed
#   2  head moved (the PR head is no longer <sha>)
#   3  checks failed
#   4  merge failed (the merge command failed, or the PR closed without merging)
#   5  dropped from the merge queue (merge-group CI failed?)
set -euo pipefail

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ] || [ -z "$1" ] || [ -z "$2" ]; then
  echo "usage: merge-when-green.sh <pr> <sha> [owner/repo]" >&2
  exit 1
fi

pr="$1"
sha="$2"
repo="${3:-}"
if [ -z "$repo" ]; then
  repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi
owner="${repo%%/*}"
name="${repo#*/}"
if [ -z "$owner" ] || [ -z "$name" ] || [ "$owner" = "$repo" ]; then
  echo "usage: merge-when-green.sh <pr> <sha> [owner/repo] (bad repo: $repo)" >&2
  exit 1
fi

# 1. Wait until no check is pending, with the head unchanged throughout.
while :; do
  head="$(gh pr view "$pr" --repo "$repo" --json headRefOid --jq .headRefOid)"
  if [ "$head" != "$sha" ]; then
    echo "HEAD MOVED $head"
    exit 2
  fi
  # A failed lookup counts as still pending: retry rather than merge blind.
  pend="$(gh pr checks "$pr" --repo "$repo" --json bucket \
    --jq '[.[]|select(.bucket=="pending")]|length' || echo error)"
  if [ "$pend" = 0 ]; then
    break
  fi
  sleep 60
done

# 2. Refuse to merge if any check failed.
bad="$(gh pr checks "$pr" --repo "$repo" --json name,bucket \
  --jq '[.[]|select(.bucket=="fail")|.name]|join(", ")')"
if [ -n "$bad" ]; then
  echo "FAILED: $bad"
  exit 3
fi

# 3. Queue the merge, bound to the exact head.
if ! gh pr merge "$pr" --repo "$repo" --match-head-commit "$sha"; then
  echo "MERGE COMMAND FAILED"
  exit 4
fi
echo "QUEUED $pr at $sha"

# 4. Follow the merge queue. The $ names are GraphQL variables, not shell ones.
# shellcheck disable=SC2016
query='query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){state mergeQueueEntry{state}}}}'
queue_state() {
  gh api graphql -f query="$query" -f owner="$owner" -f name="$name" -F n="$pr" \
    --jq '.data.repository.pullRequest | .state + " " + (.mergeQueueEntry.state // "none")'
}
while :; do
  s="$(queue_state)"
  case "$s" in
    "OPEN none")
      # GitHub briefly removes and re-adds entries when a group ahead fails:
      # require 4 readings over ~2 minutes before calling it dropped.
      gone=1
      for _ in 1 2 3; do
        sleep 40
        s="$(queue_state)"
        if [ "$s" != "OPEN none" ]; then
          gone=0
          break
        fi
      done
      if [ "$gone" = 1 ]; then
        echo "DROPPED FROM MERGE QUEUE (merge-group CI failed?)"
        exit 5
      fi
      ;;
    OPEN*) sleep 30 ;;
    *) break ;;
  esac
done

result="$(gh pr view "$pr" --repo "$repo" --json state,mergeCommit --jq '.state+" "+(.mergeCommit.oid//"")')"
echo "$result"
case "$result" in
  MERGED*) exit 0 ;;
  *)
    echo "NOT MERGED"
    exit 4
    ;;
esac
