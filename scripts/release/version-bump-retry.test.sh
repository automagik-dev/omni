#!/usr/bin/env bash
# Runs version.yml's "Commit and tag" script, extracted verbatim, against local
# bare repositories to prove how it handles a failed dev push (#1624 review):
#   normal             one attempt bumps, tags and pushes dev
#   race               dev moves (a no-release merge) and a tag appears after
#                      checkout: the non-fast-forward push retries and
#                      recomputes the NEXT number on the fresh tip
#   exhaust            dev moves before every push: exactly 3 attempts, loud
#                      failure, no tag
#   reject             the server refuses while dev did not move: no retry
#   hook_failure       the pre-push gate fails while dev moved: no retry
#   moved_during_hook  dev moves while the pre-push gate runs, so the server
#                      refuses the stale update: no retry (fails loudly)
#   lost_ack           the update lands but git reports failure: treated as
#                      pushed, one bump commit, tag pushed
#   other_ref_nff      dev advances and the push reports a non-fast-forward
#                      rejection of a DIFFERENT ref: no retry (fails loudly)
# bun is stubbed; prepare-dev-version.sh is the real script.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
[[ -x "${ROOT}/scripts/release/prepare-dev-version.sh" ]] || fail "missing executable prepare-dev-version.sh"
REAL_GIT="$(command -v git)"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

python3 - "${ROOT}/.github/workflows/version.yml" "${work}/step.sh" <<'PY'
import sys
s = open(sys.argv[1], encoding="utf-8").read()
i = s.index("      - name: Commit and tag\n")
j = s.index("        run: |\n", i) + len("        run: |\n")
out = []
for line in s[j:].split("\n"):
    if line.strip() and not line.startswith("          "):
        break
    out.append(line[10:])
open(sys.argv[2], "w", encoding="utf-8").write("\n".join(out))
PY
grep -q 'MAX_ATTEMPTS=' "${work}/step.sh" || fail "could not extract the Commit and tag script"

mkdir "${work}/bin"
cat > "${work}/bin/bun" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == "scripts/sync-versions.ts" ]]; then printf '{"version":"%s"}\n' "$2" > package.json; fi
SH
printf '#!/usr/bin/env bash\nexit 0\n' > "${work}/bin/bunx"
chmod +x "${work}/bin/bun" "${work}/bin/bunx"

export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
TODAY=$(date -u +%y%m%d)

# The command another writer runs to land a docs commit on dev.
advance_cmd() {
  # The single quotes are deliberate: $$ and $RANDOM expand in the shell that runs the command.
  # shellcheck disable=SC2016
  printf '( unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE; cd "%s/other" && "%s" pull -q origin dev && echo "$$-$RANDOM" >> docs.md && "%s" add docs.md && "%s" commit -qm "docs: %s" && "%s" push -q origin dev )' \
    "$1" "${REAL_GIT}" "${REAL_GIT}" "${REAL_GIT}" "$2" "${REAL_GIT}"
}
advance() { bash -c "$(advance_cmd "$1" "$2")"; }

# git_shim <case dir> <body>: a `git` on the step's PATH; <body> runs for the
# dev branch push, every other call goes straight to real git.
git_shim() {
  mkdir "$1/shim"
  cat > "$1/shim/git" <<SH
#!/usr/bin/env bash
if [[ " \$* " == *" push "* && " \$* " == *" HEAD:refs/heads/dev "* ]]; then
$2
fi
exec "${REAL_GIT}" "\$@"
SH
  chmod +x "$1/shim/git"
}

# run_case <name> <setup>: seeds a remote, clones the writer, applies the
# setup, runs the step; leaves its exit code in rc and its log in <dir>/log.
run_case() {
  local dir="${work}/$1"
  mkdir "${dir}"
  git init -q --bare "${dir}/remote.git"
  git clone -q "${dir}/remote.git" "${dir}/other" 2>/dev/null
  (
    cd "${dir}/other"
    git checkout -q -b dev
    mkdir -p deploy/helm/omni scripts/release
    printf '{"version":"0"}\n' > package.json
    printf 'lock\n' > bun.lock
    printf 'appVersion: 0\n' > deploy/helm/omni/Chart.yaml
    cp "${ROOT}/scripts/release/prepare-dev-version.sh" scripts/release/
    git add -A
    git commit -qm seed
    git push -q origin dev
  )
  git clone -q -b dev "${dir}/remote.git" "${dir}/writer"
  git -C "${dir}/writer" config url."${dir}/remote.git".insteadOf "https://x-access-token:TOKEN@github.com/o/r.git"
  "$2" "${dir}"
  : > "${dir}/output"
  rc=0
  (
    cd "${dir}/writer"
    PATH="${dir}/shim:${work}/bin:${PATH}" CANDIDATE="" GITHUB_TOKEN=TOKEN VERSION_WRITER_TOKEN=TOKEN \
      PUSH_REF=dev GITHUB_REPOSITORY=o/r GITHUB_OUTPUT="${dir}/output" bash "${work}/step.sh"
  ) > "${dir}/log" 2>&1 || rc=$?
}
setup_none() { :; }
setup_race() {
  advance "$1" "B, labelled no-release"
  # Today's .1 tag sits on a commit dev does not contain, so the retry only
  # sees it through its explicit tag fetch, not git's tag auto-follow.
  (
    cd "$1/other"
    git checkout -q -b side
    printf 'side\n' > side.md
    git add side.md
    git commit -qm side
    git tag "v2.${TODAY}.1"
    git push -q origin "v2.${TODAY}.1"
    git checkout -q dev
  )
}
# dev moves before each of the first 6 pushes, so an unbounded retry ends in
# a (wrong) success on the 7th instead of hanging the test.
setup_exhaust() {
  git_shim "$1" "  n=\$(cat \"$1/pushes\" 2>/dev/null || echo 0); n=\$((n + 1)); echo \"\${n}\" > \"$1/pushes\"
  if (( n <= 6 )); then $(advance_cmd "$1" moving) >/dev/null 2>&1; fi"
}
setup_reject() {
  printf '#!/bin/sh\nexit 1\n' > "$1/remote.git/hooks/pre-receive"
  chmod +x "$1/remote.git/hooks/pre-receive"
}
setup_hook_failure() {
  printf '#!/usr/bin/env bash\n%s >/dev/null 2>&1\necho "SIMULATED PRE-PUSH GATE FAILURE" >&2\nexit 1\n' \
    "$(advance_cmd "$1" "lands while the gate runs")" > "$1/writer/.git/hooks/pre-push"
  chmod +x "$1/writer/.git/hooks/pre-push"
}
setup_moved_during_hook() {
  printf '#!/usr/bin/env bash\n%s >/dev/null 2>&1\nexit 0\n' \
    "$(advance_cmd "$1" "lands while the gate runs")" > "$1/writer/.git/hooks/pre-push"
  chmod +x "$1/writer/.git/hooks/pre-push"
}
setup_lost_ack() {
  git_shim "$1" "  if [[ ! -e \"$1/acked\" ]]; then : > \"$1/acked\"; \"${REAL_GIT}\" \"\$@\"; echo 'fatal: the remote end hung up unexpectedly' >&2; exit 128; fi"
}
# The dev push fails reporting a non-fast-forward rejection of another ref
# while dev advances: only the dev ref's own status may admit a retry.
setup_other_ref_nff() {
  git_shim "$1" "  $(advance_cmd "$1" moving) >/dev/null 2>&1
  printf 'To https://github.com/o/r.git\n!\tHEAD:refs/heads/main\t[rejected] (fetch first)\nDone\n'
  echo 'error: failed to push some refs' >&2
  exit 1"
}
subject() { git -C "${work}/$1/remote.git" log -1 --format=%s dev; }
attempts() { grep -c '^Derived version: ' "${work}/$1/log" || true; }
bumps() { git -C "${work}/$1/remote.git" log --format=%s dev | grep -c '^chore(version): bump to ' || true; }
no_tag() { [[ -z "$(git -C "${work}/$1/remote.git" tag)" ]] || fail "$1: a tag was pushed"; }
no_output() { [[ ! -s "${work}/$1/output" ]] || fail "$1: outputs were emitted"; }

run_case normal setup_none
[[ "${rc}" == 0 ]] || fail "normal: exit ${rc}: $(cat "${work}/normal/log")"
[[ "$(subject normal)" == "chore(version): bump to 2.${TODAY}.1" ]] || fail "normal: dev head is '$(subject normal)'"
[[ "$(attempts normal)" == 1 ]] || fail "normal: expected one attempt"
grep -qx "version=2.${TODAY}.1" "${work}/normal/output" || fail "normal: no version output"
git -C "${work}/normal/remote.git" rev-parse -q --verify "refs/tags/v2.${TODAY}.1" >/dev/null || fail "normal: tag not pushed"

run_case race setup_race
[[ "${rc}" == 0 ]] || fail "race: exit ${rc}: $(cat "${work}/race/log")"
[[ "$(attempts race)" == 2 ]] || fail "race: expected two attempts"
[[ "$(subject race)" == "chore(version): bump to 2.${TODAY}.2" ]] || fail "race: dev head is '$(subject race)', expected a fresh-tip bump to .2"
[[ "$(git -C "${work}/race/remote.git" log -1 --format=%s dev^)" == "docs: B, labelled no-release" ]] || fail "race: the bump is not on top of the concurrent merge"
grep -qx "version=2.${TODAY}.2" "${work}/race/output" || fail "race: version output is not the recomputed number"
git -C "${work}/race/remote.git" rev-parse -q --verify "refs/tags/v2.${TODAY}.2" >/dev/null || fail "race: recomputed tag not pushed"

run_case exhaust setup_exhaust
[[ "${rc}" != 0 ]] || fail "exhaust: succeeded although dev moved under every attempt"
[[ "$(attempts exhaust)" == 3 ]] || fail "exhaust: expected exactly three attempts, saw $(attempts exhaust): $(cat "${work}/exhaust/log")"
grep -q "::error::dev moved under all 3 bump attempts" "${work}/exhaust/log" || fail "exhaust: no loud failure"
no_tag exhaust; no_output exhaust

run_case reject setup_reject
[[ "${rc}" != 0 ]] || fail "reject: succeeded although the push was refused"
[[ "$(attempts reject)" == 1 ]] || fail "reject: retried a server refusal"
grep -q "::error::the dev push failed without a non-fast-forward rejection" "${work}/reject/log" || fail "reject: wrong failure"
no_tag reject; no_output reject

run_case hook_failure setup_hook_failure
[[ "${rc}" != 0 ]] || fail "hook_failure: succeeded although the pre-push gate failed"
[[ "$(attempts hook_failure)" == 1 ]] || fail "hook_failure: retried a pre-push gate failure because dev moved"
grep -q "::error::the dev push failed without a non-fast-forward rejection" "${work}/hook_failure/log" || fail "hook_failure: wrong failure"
[[ "$(bumps hook_failure)" == 0 ]] || fail "hook_failure: a bump reached dev"
no_tag hook_failure; no_output hook_failure

run_case moved_during_hook setup_moved_during_hook
[[ "${rc}" != 0 ]] || fail "moved_during_hook: succeeded although the server refused the stale update"
[[ "$(attempts moved_during_hook)" == 1 ]] || fail "moved_during_hook: retried a server refusal"
grep -q "::error::the dev push failed without a non-fast-forward rejection" "${work}/moved_during_hook/log" || fail "moved_during_hook: wrong failure"
no_tag moved_during_hook; no_output moved_during_hook

run_case lost_ack setup_lost_ack
[[ "${rc}" == 0 ]] || fail "lost_ack: exit ${rc}: $(cat "${work}/lost_ack/log")"
[[ "$(attempts lost_ack)" == 1 ]] || fail "lost_ack: re-bumped after the update landed ($(attempts lost_ack) attempts)"
[[ "$(bumps lost_ack)" == 1 ]] || fail "lost_ack: $(bumps lost_ack) bump commits reached dev, expected one"
grep -q "already contains" "${work}/lost_ack/log" || fail "lost_ack: the landed update was not recognised"
grep -qx "version=2.${TODAY}.1" "${work}/lost_ack/output" || fail "lost_ack: no version output"
[[ "$(git -C "${work}/lost_ack/remote.git" rev-parse "v2.${TODAY}.1^{commit}")" == "$(git -C "${work}/lost_ack/remote.git" rev-parse dev)" ]] || fail "lost_ack: the tag is not on the landed bump"

run_case other_ref_nff setup_other_ref_nff
[[ "${rc}" != 0 ]] || fail "other_ref_nff: succeeded although dev was never pushed"
[[ "$(attempts other_ref_nff)" == 1 ]] || fail "other_ref_nff: retried on another ref's non-fast-forward ($(attempts other_ref_nff) attempts)"
grep -q "::error::the dev push failed without a non-fast-forward rejection" "${work}/other_ref_nff/log" || fail "other_ref_nff: wrong failure"
[[ "$(bumps other_ref_nff)" == 0 ]] || fail "other_ref_nff: a bump reached dev"
no_tag other_ref_nff; no_output other_ref_nff

printf 'PASS: version bump push handling (normal, race, exhaust, reject, hook_failure, moved_during_hook, lost_ack, other_ref_nff)\n'
