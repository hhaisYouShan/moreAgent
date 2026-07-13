# Documentation authority

This directory is the canonical documentation entry for AI Software Company OS.

## Current sources of truth

| Subject | Canonical source |
|---|---|
| Product goal and lifecycle | Root `README.md` |
| Repository and system architecture | `docs/architecture.md` |
| Program stages and current implementation order | `docs/roadmap.md` |
| Legacy extraction status | `docs/migration-ledger.md` |
| Runtime machine contracts | `schemas/` and `src/contracts/` |
| Runtime state | Workflow, Run, Task, Event, Gate Result, Issue, Artifact, and Evidence records |
| Consumer-project business truth | The consumer project's own repository |

## Authority order

```text
Runtime structured state and evidence
> Approved decisions and machine contracts
> docs/ canonical architecture and roadmap
> compatibility documentation
> historical snapshots
> chat summaries and Agent inference
```

## Documentation rules

1. Canonical product and architecture documents must be project-agnostic.
2. BossResume-specific paths, PRDs, current workflow state, and product conclusions must not be copied into canonical OS documents.
3. Markdown explains contracts; JSON Schema and code enforce them.
4. A concept has one canonical document. Other files link to it rather than restating it.
5. Historical and compatibility documents must be explicitly labeled and cannot advance current program state.
6. Current progress is recorded only in `docs/roadmap.md`; legacy extraction status is recorded only in `docs/migration-ledger.md`.

## Document classes

- `docs/`: current OS product, architecture, roadmap, and migration facts.
- `schemas/`: runtime data contracts.
- `projects/` or `validation/`: project adapters, fixtures, benchmarks, and validation results.
- `agent-loop-docs/` and `scripts/agent-loop/`: compatibility implementation until extraction is complete.
- historical material: read-only reference, never a current fact source.
