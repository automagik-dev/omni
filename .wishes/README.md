# Wish Documents

This directory contains wish documents created by the `/wish` command.

## Structure

```
.wishes/
├── <slug>/
│   └── <slug>-wish.md    # The wish document
└── README.md             # This file
```

## Wish Lifecycle

```
DRAFT → APPROVED → IN_PROGRESS → REVIEW → COMPLETE
                              ↓
                           BLOCKED
```

## Creating a Wish

Run `/wish` to start the wish dance:

1. **Resonate** - Understand the why
2. **Align** - Connect to context
3. **Scope** - Define boundaries
4. **Blueprint** - Create execution groups
5. **Handoff** - Ready for `/forge`

## Executing a Wish

Run `/forge` with an approved wish to execute:

1. **Load** - Read the wish contract
2. **Plan** - Break into tasks
3. **Execute** - Dispatch specialists
4. **Review** - Validate each task
5. **Handoff** - Ready for `/review`

## Validating a Wish

Run `/review` after forge completes:

1. **Load** - Read the wish criteria
2. **Validate** - Run validation commands
3. **Check** - Evaluate each criterion
4. **Verdict** - SHIP / FIX-FIRST / BLOCKED
5. **Update** - Record in wish document
