#!/usr/bin/env python3
import argparse
from typing import NoReturn


def fail(message: str) -> NoReturn:
    raise SystemExit(f"release state verification failed: {message}")


def boolean(value: str) -> bool:
    if value == "true":
        return True
    if value == "false":
        return False
    fail(f"invalid boolean {value}")


parser = argparse.ArgumentParser()
parser.add_argument("--phase", choices=("existing", "final"), required=True)
parser.add_argument("--channel", choices=("stable", "dev"), required=True)
parser.add_argument("--draft", required=True)
parser.add_argument("--prerelease", required=True)
parser.add_argument("--requested-draft", default="false")
args = parser.parse_args()
draft = boolean(args.draft)
prerelease = boolean(args.prerelease)
requested_draft = boolean(args.requested_draft)
expected_prerelease = args.channel != "stable"

if args.phase == "existing":
    if not draft:
        if requested_draft:
            fail("an existing public release cannot become a draft")
        if prerelease != expected_prerelease:
            fail("existing public release channel classification is immutable")
else:
    if requested_draft:
        if not draft:
            fail("final release is public but a draft was requested")
    elif draft or prerelease != expected_prerelease:
        fail("final public release state does not match the requested channel")
print("release_state_verified=true")
