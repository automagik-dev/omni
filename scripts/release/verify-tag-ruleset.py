#!/usr/bin/env python3
import argparse
import fnmatch
import json
from pathlib import Path
from typing import Any, Never


def fail(message: str) -> Never:
    raise SystemExit(f"tag ruleset verification failed: {message}")


parser = argparse.ArgumentParser(description="Verify that one active ruleset effectively protects an exact release tag")
parser.add_argument("--ruleset-json", required=True)
parser.add_argument("--tag", required=True)
args = parser.parse_args()

if not args.tag.startswith("refs/tags/v"):
    fail("candidate is not a v* tag ref")
decoded: Any = None
try:
    decoded = json.loads(Path(args.ruleset_json).read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as exc:
    fail(f"ruleset JSON is unreadable: {exc}")
if not isinstance(decoded, dict):
    fail("ruleset JSON is not an object")
ruleset: dict[str, Any] = decoded
if ruleset.get("target") != "tag" or ruleset.get("enforcement") != "active":
    fail("ruleset is not active for tags")
if ruleset.get("bypass_actors"):
    fail("ruleset has bypass actors")
ref_name = (ruleset.get("conditions") or {}).get("ref_name") or {}
includes = ref_name.get("include") or []
excludes = ref_name.get("exclude") or []

def matches(pattern: object) -> bool:
    if not isinstance(pattern, str):
        return False
    if pattern == "~ALL":
        return True
    if pattern.startswith("~"):
        return False
    return fnmatch.fnmatchcase(args.tag, pattern)

if not any(matches(pattern) for pattern in includes):
    fail("candidate tag is not included")
if any(matches(pattern) for pattern in excludes):
    fail("candidate tag is explicitly excluded")
rule_types = {rule.get("type") for rule in ruleset.get("rules") or [] if isinstance(rule, dict)}
missing = {"update", "deletion"} - rule_types
if missing:
    fail(f"ruleset is missing protections: {sorted(missing)}")
print("ruleset_protects_tag=true")
