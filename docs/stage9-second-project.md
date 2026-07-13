# Stage 9 second-project validation

```yaml
status: prepared
stage: 9
project: pallets/itsdangerous
repository_ref: main
```

## Selection rationale

The second real project must differ materially from BossResume. `pallets/itsdangerous` provides four independent differences:

1. Python instead of TypeScript/JavaScript.
2. Reusable library instead of a full-stack business application.
3. `pyproject.toml` and pytest instead of npm multi-package scripts.
4. No browser UI, database schema, application deployment or business workflow.

The purpose is not to change or release ItsDangerous. The OS validates that project differences can be handled through a Python Project Adapter and validation profiles without changing Core Domain, Workflow, Gate, Task or Evidence contracts.

## Validation scope

```text
Real Git baseline
→ pyproject.toml parsing
→ Python capability adapter
→ pytest and package import
→ generic Project Map
→ Stage 9 Task DAG
→ policy dry run
→ validation-only Task Commit
→ real ephemeral Integration Commit
→ cleanup and no upstream push
→ structured generality report
```

## Safety boundaries

- Upstream source and tests are read-only.
- The only temporary repository change is `.moreagent-validation/stage7-smoke.json` in ephemeral local branches.
- No branch or Commit is pushed to `pallets/itsdangerous`.
- No product or user acceptance is implied.
- A passing result means OS portability is demonstrated for the agreed validation scope; it does not claim delivery ownership of the external project.
