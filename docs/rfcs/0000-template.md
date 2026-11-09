# RFC-NNNN: Title

Copy this file to `NNNN-short-name.md` (next free number), add its row to the index in
[README.md](README.md), and keep it to about 60-150 lines. Delete this paragraph.

| Field | Value |
|---|---|
| Status | Draft |
| Milestone | outcome name, or none |
| Issue | #NNNN |
| Design | link to `.genie/brainstorms/<slug>/DESIGN.md` and the WISH |
| Created | YYYY-MM-DD |

## Summary

Two to four sentences: what changes for users, and what it decides.

## Motivation

The problem, who has it, and the issues it links.

## Design

What is built, in plain sentences. The detail stays in the linked DESIGN; do not copy it here.

## Contracts introduced

Every public route, event type, schema column, CLI flag, scope and storage key this RFC creates
or changes. For each one, the compatibility rule for existing installs and older clients.

## Threat model

Required when the RFC adds a trust boundary: who can reach it, what it can do, how it is
authenticated, and how to undo it.

## Deliveries

Numbered slices, each one issue and one PR. Each says:

- acceptance check: the one test or observation that proves it;
- rollback: what reverting it does, and what it cannot undo (migrations are additive).

## Progress

Deliveries merged so far, with PR numbers. The index Status stays one word.

## Open questions

Each question with a recommended answer.

## Links

Issues, PRs, other RFCs and ADRs.
