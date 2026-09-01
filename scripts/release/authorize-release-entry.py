#!/usr/bin/env python3
import argparse
import re


def fail(message: str) -> None:
    raise SystemExit(f"release entry authorization failed: {message}")


parser = argparse.ArgumentParser(description="Classify reusable orchestration versus direct recovery")
parser.add_argument("--channel", required=True, choices=("stable", "homolog", "dev"))
parser.add_argument("--orchestrated", required=True, choices=("true", "false"))
parser.add_argument("--recovery-run-id", default="")
args = parser.parse_args()

orchestrated = args.orchestrated == "true"
if args.channel == "stable" and not orchestrated:
    fail("direct stable workflow_dispatch is disabled; use verified image orchestration")
if orchestrated:
    if args.recovery_run_id:
        fail("orchestrated publication must use artifacts from its current run")
    print("mode=orchestrated")
else:
    if re.fullmatch(r"[0-9]+", args.recovery_run_id) is None:
        fail("direct recovery requires an exact numeric sign-attest run ID")
    print("mode=recovery")
