# Legacy compatibility area

This directory is reserved for compatibility implementations retained while reusable capabilities are extracted into AI Software Company OS Core.

Current compatibility sources still live in `scripts/agent-loop/`, `agent-loop-docs/`, and `projects/bossresume/`. They will move here incrementally only when the move does not break migration evidence or parity tests.

A capability follows this lifecycle:

```text
REFERENCE
→ EXTRACTING
→ DUAL_RUN_PASS
→ SWITCHED
→ DELETABLE
→ REMOVED
```

Rules:

- New generic capabilities are implemented in Core, not in Legacy.
- Legacy receives only fixes required to preserve reference behavior or unblock extraction.
- Legacy is never a canonical product, architecture, or roadmap fact source.
- A capability is removed only after the Core replacement has contract tests, parity evidence, and a single public entrypoint.
