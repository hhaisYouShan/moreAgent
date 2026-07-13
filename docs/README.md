# Documentation authority

This directory is the canonical documentation entry for AI Software Company OS.

## Current sources of truth

| Subject | Canonical source |
|---|---|
| Product goal and lifecycle | Root `README.md` |
| Repository and system architecture | `docs/architecture.md` |
| Program stages and implementation order | `docs/roadmap.md` |
| Machine-readable stage progress | `docs/program-status.json` |
| Repository path classification | `docs/repository-inventory.md` |
| Legacy extraction status | `docs/migration-ledger.md` |
| Runtime machine contracts | `schemas/` and `src/contracts/` |
| Runtime state | Workflow, Run, Task, Event, Gate Result, Issue, Artifact, and Evidence records |
| Consumer-project business truth | The consumer project's own repository |

## Authority order

```text
Runtime structured state and evidence
> Approved decisions and machine contracts
> docs/ canonical architecture, roadmap and program status
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
6. Current stage progress is recorded in `docs/program-status.json` and presented in `docs/roadmap.md`.
7. Legacy extraction status is recorded only in `docs/migration-ledger.md`.
8. Repository path authority and migration class are recorded only in `docs/repository-inventory.md`.

## Document classes

- `docs/`: current OS product, architecture, roadmap, program status, inventory and migration facts.
- `schemas/`: runtime data contracts.
- `src/`: portable implementation.
- `profiles/`: declarative project-agnostic profiles.
- `adapters/`: tool and project boundary translations.
- `validation/`: synthetic and real-project validation assets.
- `agent-loop-docs/` and `scripts/agent-loop/`: compatibility implementation until extraction is complete.
- `projects/bossresume/` and `migration-reference/`: historical or immutable migration reference.
- historical material: read-only reference, never a current fact source.