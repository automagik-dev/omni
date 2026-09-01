#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/scripts/release/verify-remote-tag.sh"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
[[ -x "${SCRIPT}" ]] || fail "missing executable ${SCRIPT}"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
git init -q --bare "${work}/remote.git"
git init -q "${work}/source"
(
  cd "${work}/source"
  git config user.name test
  git config user.email test@example.com
  printf 'fixture\n' > file
  git add file
  git commit -qm fixture
  git branch -M main
  git remote add origin "file://${work}/remote.git"
  git push -q origin main
  git tag v2.260830.2
  git push -q origin refs/tags/v2.260830.2
)
SHA="$(git -C "${work}/source" rev-parse HEAD)"
git --git-dir="${work}/remote.git" symbolic-ref HEAD refs/heads/main
git clone -q --depth=1 --no-tags "file://${work}/remote.git" "${work}/shallow"
(
  cd "${work}/shallow"
  ! git show-ref --verify --quiet refs/tags/v2.260830.2 || fail "fixture unexpectedly fetched tags"
  "${SCRIPT}" --remote origin --version 2.260830.2 --mode exact --expected-sha "${SHA}"
  "${SCRIPT}" --remote origin --version 2.260830.3 --mode absent
  if "${SCRIPT}" --remote origin --version 2.260830.2 --mode absent; then
    fail "remote tag hidden by shallow no-tags clone was accepted as absent"
  fi
  if "${SCRIPT}" --remote origin --version 2.260830.2 --mode exact --expected-sha 0000000000000000000000000000000000000000; then
    fail "remote tag move was accepted"
  fi
)
printf 'PASS: shallow-clone-independent remote release tag contract\n'
