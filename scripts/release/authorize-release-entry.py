#!/usr/bin/env python3
import argparse
import re


def fail(message: str) -> None:
    raise SystemExit(f"release entry authorization failed: {message}")


parser = argparse.ArgumentParser(description="Classify reusable orchestration versus direct recovery")
parser.add_argument("--channel", required=True, choices=("stable", "dev"))
parser.add_argument("--orchestrated", required=True, choices=("true", "false"))
parser.add_argument("--recovery-run-id", default="")
parser.add_argument("--version", default="")
parser.add_argument("--source-ref", default="")
parser.add_argument("--source-sha", default="")
parser.add_argument("--expected-sha", default="")
args = parser.parse_args()

orchestrated = args.orchestrated == "true"
if args.channel == "stable" and not orchestrated:
    fail("direct stable workflow_dispatch is disabled; use verified image orchestration")
if orchestrated:
    if args.recovery_run_id:
        fail("orchestrated publication must use artifacts from its current run")
else:
    if re.fullmatch(r"[0-9]+", args.recovery_run_id) is None:
        fail("direct recovery requires an exact numeric sign-attest run ID")

if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", args.version) is None:
    fail("publication requires an exact semantic version")
if args.source_ref != f"refs/tags/v{args.version}":
    fail("publication must run from the exact version tag")
if re.fullmatch(r"[0-9a-f]{40}", args.source_sha) is None:
    fail("publication source SHA is invalid")
if re.fullmatch(r"[0-9a-f]{40}", args.expected_sha) is None:
    fail("publication requires an exact expected source SHA")
if args.expected_sha != args.source_sha:
    fail("publication expected SHA does not match the verified source SHA")
print("mode=orchestrated" if orchestrated else "mode=recovery")
