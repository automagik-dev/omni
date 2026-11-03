#!/usr/bin/env bash
# merge-when-green.test.sh: tests merge-when-green.sh against a stub gh. No network: a fake gh and a
# no-op sleep are first on PATH, and the fake applies each --jq filter (with jq) to canned JSON.
# Usage: .herdr/tools/merge-when-green.test.sh   (needs bash and jq; exits non-zero on any failure)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/merge-when-green.sh"
command -v jq >/dev/null || {
  echo "merge-when-green.test.sh needs jq" >&2
  exit 1
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

# The fake gh. Per-case files in $STUB_DIR: head, checks and queue hold one answer per line, used in
# order, the last one repeating; final is the closing pr view; merge_rc is the merge exit code;
# fail.<view|checks|graphql> holds an exit code that call fails with. checks line NONE: gh's
# zero-checks error. Every call is appended to $STUB_DIR/log.
cat >"$tmp/bin/gh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
d="$STUB_DIR"
printf 'gh %s\n' "$*" >>"$d/log"
nth() {
  local n lines
  n=$(($(cat "$d/$1.n" 2>/dev/null || echo 0) + 1))
  echo "$n" >"$d/$1.n"
  lines=$(($(wc -l <"$d/$1")))
  if [ "$n" -gt "$lines" ]; then n=$lines; fi
  sed -n "${n}p" "$d/$1"
}
filter="" prev=""
for a in "$@"; do
  if [ "$prev" = --jq ]; then filter="$a"; fi
  prev="$a"
done
out() { if [ -n "$filter" ]; then jq -r "$filter"; else cat; fi; }
fail_if() {
  if [ -f "$d/fail.$1" ]; then
    echo "stub gh: $1 failed" >&2
    exit "$(cat "$d/fail.$1")"
  fi
}
case "$1 $2" in
  "repo view") echo '{"nameWithOwner":"acme/widgets"}' | out ;;
  "pr view")
    if [[ "$*" == *headRefOid* ]]; then
      fail_if view
      printf '{"headRefOid":"%s"}\n' "$(nth head)" | out
    else
      out <"$d/final"
    fi
    ;;
  "pr checks")
    fail_if checks
    line="$(nth checks)"
    if [ "$line" = NONE ]; then
      echo "no checks reported on the 'feature' branch" >&2
      exit 1
    fi
    printf '%s\n' "$line" | out
    ;;
  "pr merge")
    if [[ "$*" == *--disable-auto* ]]; then exit 0; fi
    exit "$(cat "$d/merge_rc" 2>/dev/null || echo 0)"
    ;;
  "api graphql")
    fail_if graphql
    s="$(nth queue)"
    entry=null
    if [ "${s#* }" != none ]; then entry="{\"state\":\"${s#* }\"}"; fi
    printf '{"data":{"repository":{"pullRequest":{"state":"%s","mergeQueueEntry":%s}}}}\n' "${s%% *}" "$entry" | out
    ;;
  *)
    echo "stub gh: unexpected call: $*" >&2
    exit 99
    ;;
esac
STUB
cat >"$tmp/bin/sleep" <<'STUB'
#!/usr/bin/env bash
printf 'sleep %s\n' "$*" >>"$STUB_DIR/log"
STUB
chmod +x "$tmp/bin/gh" "$tmp/bin/sleep"
export PATH="$tmp/bin:$PATH"
if [ "$(command -v gh)" != "$tmp/bin/gh" ]; then
  echo "stub gh is not first on PATH" >&2
  exit 1
fi

SHA=1111111111111111111111111111111111111111
OTHER=2222222222222222222222222222222222222222
GREEN='[{"name":"Quality Gate","bucket":"pass"},{"name":"Smoke Test","bucket":"pass"}]'
PENDING='[{"name":"Quality Gate","bucket":"pending"},{"name":"Smoke Test","bucket":"pass"}]'
MERGE="gh pr merge 42 --repo acme/widgets --match-head-commit $SHA"

failures=0
fail() {
  echo "FAIL $case_name: $*"
  failures=$((failures + 1))
}

# new_case <name>: defaults are one green read, an unchanged head, queued then merged.
new_case() {
  case_name="$1"
  STUB_DIR="$tmp/$1"
  export STUB_DIR
  mkdir -p "$STUB_DIR"
  : >"$STUB_DIR/log"
  echo "$SHA" >"$STUB_DIR/head"
  echo "$GREEN" >"$STUB_DIR/checks"
  printf '%s\n' "OPEN QUEUED" "MERGED none" >"$STUB_DIR/queue"
  echo '{"state":"MERGED","mergeCommit":{"oid":"3333333333333333333333333333333333333333"}}' >"$STUB_DIR/final"
}
# lines <file> <answer>...: one answer per line, used in order.
lines() {
  local f="$STUB_DIR/$1"
  shift
  printf '%s\n' "$@" >"$f"
}

# run <want> [- args...]: without "-", the args are 42 <sha> acme/widgets.
run() {
  local want="$1" rc=0
  shift
  if [ "$#" = 0 ]; then
    set -- 42 "$SHA" acme/widgets
  else
    shift
  fi
  bash "$script" "$@" >"$STUB_DIR/out" 2>&1 || rc=$?
  if [ "$rc" != "$want" ]; then fail "exit $rc, want $want: $(tr '\n' ' ' <"$STUB_DIR/out")"; fi
}
has() { grep -qF -- "$1" "$STUB_DIR/log" || fail "no call matching: $1"; }
lacks() { if grep -qF -- "$1" "$STUB_DIR/log"; then fail "unexpected call: $1"; fi; }
says() { grep -qF -- "$1" "$STUB_DIR/out" || fail "output lacks: $1"; }
count() {
  local n
  n=$(grep -cxF -- "$1" "$STUB_DIR/log" || true)
  [ "$n" = "$2" ] || fail "$n calls of '$1', want $2"
}
done_case() {
  if [ "$failures" = "$before" ]; then echo "PASS $case_name"; fi
}
start() {
  before=$failures
  new_case "$1"
}

start all-pass
run 0
has "$MERGE"
says "MERGED 3333"
lacks "--disable-auto"
done_case

start repo-from-gh-repo-view
run 0 - 42 "$SHA"
has "gh repo view --json nameWithOwner"
has "$MERGE"
done_case

start skipping-counts-as-green
echo '[{"name":"Quality Gate","bucket":"pass"},{"name":"Secrets Scan","bucket":"skipping"}]' >"$STUB_DIR/checks"
run 0
has "$MERGE"
done_case

start pending-then-green
lines checks "$PENDING" "$GREEN"
run 0
count "sleep 60" 1
has "$MERGE"
done_case

start cancelled-check
echo '[{"name":"Quality Gate","bucket":"cancel"},{"name":"Smoke Test","bucket":"pass"}]' >"$STUB_DIR/checks"
run 11
says "Quality Gate=cancel"
lacks "--match-head-commit"
done_case

start failed-check
echo '[{"name":"Quality Gate","bucket":"fail"},{"name":"Smoke Test","bucket":"pass"}]' >"$STUB_DIR/checks"
run 11
says "Quality Gate=fail"
lacks "--match-head-commit"
done_case

start zero-checks-empty-list
echo '[]' >"$STUB_DIR/checks"
run 11
says "no checks reported"
lacks "--match-head-commit"
done_case

start zero-checks-gh-error
echo NONE >"$STUB_DIR/checks"
run 11
lacks "--match-head-commit"
done_case

start head-moved-during-wait
lines head "$SHA" "$OTHER"
lines checks "$PENDING" "$GREEN"
run 10
says "HEAD MOVED $OTHER"
lacks "--match-head-commit"
done_case

start head-moved-right-before-merge
lines head "$SHA" "$OTHER"
run 10
lacks "--match-head-commit"
done_case

start merge-refused-head-moved
lines head "$SHA" "$SHA" "$OTHER"
echo 1 >"$STUB_DIR/merge_rc"
run 10
has "$MERGE"
done_case

start merge-command-fails
echo 1 >"$STUB_DIR/merge_rc"
run 12
says "MERGE COMMAND FAILED"
done_case

start gh-error-on-checks
echo 1 >"$STUB_DIR/fail.checks"
run 15
lacks "--match-head-commit"
count "sleep 60" 0
done_case

start gh-auth-error-on-head
echo 4 >"$STUB_DIR/fail.view"
run 15
lacks "--match-head-commit"
done_case

start gh-error-in-queue
echo 1 >"$STUB_DIR/fail.graphql"
run 15
has "$MERGE"
done_case

start checks-wait-timeout
echo "$PENDING" >"$STUB_DIR/checks"
run 14
count "sleep 60" 59
lacks "--match-head-commit"
done_case

start queue-wait-timeout
echo "OPEN QUEUED" >"$STUB_DIR/queue"
run 14
count "sleep 30" 119
lacks "--disable-auto"
done_case

start dropped-from-queue
lines queue "OPEN QUEUED" "OPEN none"
run 13
has "gh pr merge 42 --repo acme/widgets --disable-auto"
count "sleep 40" 3
done_case

start removed-then-re-added
lines queue "OPEN none" "OPEN none" "OPEN QUEUED" "MERGED none"
run 0
lacks "--disable-auto"
done_case

start closed-without-merging
echo "CLOSED none" >"$STUB_DIR/queue"
echo '{"state":"CLOSED","mergeCommit":null}' >"$STUB_DIR/final"
run 12
says "NOT MERGED"
done_case

start usage-no-args
run 16 -
lacks "gh "
done_case

start usage-one-arg
run 16 - 42
done_case

start usage-bad-repo
run 16 - 42 "$SHA" widgets
done_case

if [ "$failures" != 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi
echo "all cases passed"
