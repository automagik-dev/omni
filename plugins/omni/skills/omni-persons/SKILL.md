---
name: omni-persons
description: "Search people and contacts, inspect cross-channel identity and presence, and manage authorized identity merges."
allowed-tools: Bash(omni *), Bash(jq *)
---

# Omni Persons

## When to Use

Find a person by phone or identity, inspect their channel contacts/presence, or merge identities with explicit approval.

## Flow

1. Read [ground rules](../omni-ops/references/ground-rules.md) and [person operations](../omni-ops/references/persons.md).
2. Discover installed options with `omni persons --help`; resolve the intended identity before any mutation.
3. Inspect the requested records and verify authorized changes with a follow-up read.

## Rules

- Merging identities is destructive; pause for the user before doing it.
- Return only needed personal fields and never infer permission to contact someone from search results.
