#!/usr/bin/env python3
import argparse
import json
import pathlib
import re
from typing import NoReturn


def fail(message: str) -> NoReturn:
    raise SystemExit(f"orchestrator verification failed: {message}")


parser = argparse.ArgumentParser()
parser.add_argument("--run-json", required=True)
parser.add_argument("--repository", required=True)
parser.add_argument("--source-sha", required=True)
parser.add_argument("--expected-workflow", default=".github/workflows/image-build.yml")
parser.add_argument("--required-status", choices=("in_progress", "completed"), default="in_progress")
parser.add_argument("--allowed-event", action="append", choices=("push", "workflow_dispatch"))
args = parser.parse_args()

if re.fullmatch(r"[0-9a-f]{40}", args.source_sha) is None:
    fail("source SHA is invalid")
try:
    run = json.loads(pathlib.Path(args.run_json).read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as exc:
    fail(f"invalid run JSON: {exc}")
if not isinstance(run, dict):
    fail("run JSON is not an object")
repository = run.get("repository")
if not isinstance(repository, dict) or repository.get("full_name") != args.repository:
    fail("workflow run repository does not match")
if run.get("path") != args.expected_workflow:
    fail(f"caller is not {args.expected_workflow}")
if run.get("head_sha") != args.source_sha:
    fail("caller head SHA does not match")
if run.get("status") != args.required_status:
    fail(f"caller run is not {args.required_status}")
if args.required_status == "completed" and run.get("conclusion") != "success":
    fail("completed caller run did not succeed")
allowed_events = set(args.allowed_event or ("push", "workflow_dispatch"))
if run.get("event") not in allowed_events:
    fail("caller event is not an approved image publication event")
print("orchestrator_run_verified=true")
