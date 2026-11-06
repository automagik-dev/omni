#!/usr/bin/env bash
# Runs version.yml's "Commit and tag" script, extracted verbatim, against local
# bare repositories to prove its bounded fresh-tip retry (#1624 review):
#   normal   one attempt bumps, tags and pushes dev
#   race     dev moves (a no-release merge) and a tag appears after checkout:
#            the rejected push retries and recomputes the NEXT number
#   exhaust  dev moves under every attempt: fails after exactly 3, no tag
#   reject   the push is refused while dev did not move: fails at once
# bun is stubbed; prepare-dev-version.sh is the real script.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
[[ -x "${ROOT}/scripts/release/prepare-dev-version.sh" ]] || fail "missing executable prepare-dev-version.sh"
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

# advance <case dir> <label>: another writer lands a commit on dev.
advance() {
  (
    unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
    cd "$1/other"
    git pull -q origin dev
    printf '%s\n' "$2" >> docs.md
    git add docs.md
    git commit -qm "docs: $2"
    git push -q origin dev
  )
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
    PATH="${work}/bin:${PATH}" CANDIDATE="" GITHUB_TOKEN=TOKEN VERSION_WRITER_TOKEN=TOKEN \
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
setup_exhaust() {
  cat > "$1/writer/.git/hooks/pre-push" <<SH
#!/usr/bin/env bash
( unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE; cd "$1/other" && git pull -q origin dev && date +%s%N >> docs.md && git add docs.md && git commit -qm "docs: moving" && git push -q origin dev )
SH
  chmod +x "$1/writer/.git/hooks/pre-push"
}
setup_reject() {
  printf '#!/bin/sh\nexit 1\n' > "$1/remote.git/hooks/pre-receive"
  chmod +x "$1/remote.git/hooks/pre-receive"
}
subject() { git -C "${work}/$1/remote.git" log -1 --format=%s dev; }
attempts() { grep -c '^Derived version: ' "${work}/$1/log" || true; }

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
[[ "$(attempts exhaust)" == 3 ]] || fail "exhaust: expected exactly three attempts, saw $(attempts exhaust)"
grep -q "::error::dev moved under all 3 bump attempts" "${work}/exhaust/log" || fail "exhaust: no loud failure"
[[ -z "$(git -C "${work}/exhaust/remote.git" tag)" ]] || fail "exhaust: a tag was pushed"

run_case reject setup_reject
[[ "${rc}" != 0 ]] || fail "reject: succeeded although the push was refused"
[[ "$(attempts reject)" == 1 ]] || fail "reject: retried although dev did not move"
grep -q "::error::the dev push was rejected but dev did not move" "${work}/reject/log" || fail "reject: wrong failure"

printf 'PASS: version bump fresh-tip retry (normal, race, exhaust, reject)\n'
