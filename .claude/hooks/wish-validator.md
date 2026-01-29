# Wish Validator Hook

> Auto-validates wish documents after creation or modification

## Trigger

This hook fires on every `stop` event (after each response).

## Fast Exit

Exit immediately if:
- `.wishes/` directory doesn't exist
- No wish files modified in last 60 seconds

This ensures < 1 second overhead for non-wish responses.

## Validation Checks

### 1. Structure

Required sections:
- [ ] Summary (2-3 sentences)
- [ ] Context (background, motivation)
- [ ] Scope (IN/OUT sections)
- [ ] Success Criteria
- [ ] Execution Groups (1-3)

### 2. Execution Groups

Each group must have:
- [ ] Clear goal
- [ ] Specific deliverables (checkboxes)
- [ ] Acceptance criteria (checkboxes)
- [ ] Validation commands

### 3. Scope Boundaries

- [ ] IN SCOPE section populated
- [ ] OUT OF SCOPE section populated
- [ ] No contradictions between sections
- [ ] Deliverables match IN SCOPE items

## Output

### Pass
```
Wish validation: PASS - Document is well-structured.
```

### Needs Attention
```
Wish validation: NEEDS ATTENTION
- Missing acceptance criteria in Group B
- No validation command in Group C
- OUT OF SCOPE section is empty
```

## Implementation

```bash
#!/bin/bash
# Quick check for recently modified wish files

WISHES_DIR=".wishes"

# Fast exit if no wishes directory
if [ ! -d "$WISHES_DIR" ]; then
  exit 0
fi

# Find wish files modified in last 60 seconds
RECENT=$(find "$WISHES_DIR" -name "*-wish.md" -mmin -1 2>/dev/null)

if [ -z "$RECENT" ]; then
  exit 0
fi

# Validate each recent wish file
for file in $RECENT; do
  echo "Validating: $file"

  # Check for required sections
  if ! grep -q "## Summary" "$file"; then
    echo "  - Missing Summary section"
  fi

  if ! grep -q "## Scope" "$file"; then
    echo "  - Missing Scope section"
  fi

  if ! grep -q "## Execution Group" "$file"; then
    echo "  - Missing Execution Groups"
  fi

  if ! grep -q "**Validation:**" "$file"; then
    echo "  - Missing validation commands"
  fi
done
```

## Notes

- This hook is advisory only
- Does not block responses
- Provides immediate feedback on wish quality
- Helps maintain consistent wish documents
