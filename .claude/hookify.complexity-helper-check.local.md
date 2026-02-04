---
name: complexity-helper-check
enabled: true
event: bash
pattern: noExcessiveCognitiveComplexity|complexity.*exceeded|cognitive complexity
---

🔍 **Complexity Warning Detected - Search Before Creating Helpers!**

Before extracting new helper functions, you **MUST** search for existing utilities:

```bash
# Search for similar function names
rg "function (format|parse|transform|validate|convert|handle|process)" packages/

# Search utils/helpers directories
rg "export (function|const)" packages/*/src/utils/
rg "export (function|const)" packages/*/src/helpers/

# Check core package specifically
rg "export" packages/core/src/utils/
```

**Common utility locations:**
| Type | Location |
|------|----------|
| String/formatting | `packages/core/src/utils/` |
| Validation | `packages/core/src/schemas/` |
| ID generation | `packages/core/src/identity/` |
| Error helpers | `packages/core/src/errors/` |

**Workflow:**
1. ✅ Search first - find similar existing functions
2. ✅ Reuse if exists - import the existing helper
3. ✅ Extend if close - if 80% match, consider extending
4. ✅ Create if truly new - only when no suitable option exists

**Do NOT create a new helper without first searching the codebase!**
