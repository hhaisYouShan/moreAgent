# Canonical runtime contracts

```yaml
status: active
version: 1.0
updated_at: 2026-07-13
stage: 2
```

AI Software Company OS uses project-agnostic Domain values and JSON Schema 2020-12 contracts. Markdown explains intent; `schemas/` and `src/contracts/` determine runtime validity.

## Canonical contract families

| Schema | Entities |
|---|---|
| `common.schema.json` | IDs, hashes, timestamps, enums, command evidence |
| `project.schema.json` | Project |
| `workflow.schema.json` | Workflow and current lifecycle position |
| `task.schema.json` | Atomic Task and execution boundaries |
| `work.schema.json` | Workstream and Attempt |
| `execution.schema.json` | Agent Contract, Agent Result, Run, Session, Workspace |
| `governance.schema.json` | Gate Result, Issue, Checkpoint, User Decision, Acceptance |
| `evidence.schema.json` | Artifact, Evidence, Event, Project Map, Requirement Trace, Context Manifest, Integration Evidence, Release Evidence |

All schemas use `$id` values under `https://moreagent.dev/schemas/` and are compiled by `src/contracts/schema-registry.mjs`.

## Canonical lifecycle vocabulary

The implementation source is `src/domain/enums.mjs`.

### Workflow phases

```text
INTAKE
→ PRODUCT_DESIGN
→ MULTI_ROLE_REVIEW
→ TECHNICAL_DESIGN
→ TASK_PLANNING
→ IMPLEMENTATION
→ REVIEW
→ INTEGRATION
→ SYSTEM_TEST
→ PRODUCT_ACCEPTANCE
→ USER_ACCEPTANCE
→ RELEASE
→ MAINTENANCE
→ ARCHIVED
```

### Gate conclusions

```text
APPROVED
CHANGES_REQUESTED
BLOCKED
FAILED
```

`PASS` and `FAIL` are not Core conclusions. A compatibility adapter may translate them before validation.

### Failure decisions

```text
AUTO_FIXABLE
HUMAN_DECISION_REQUIRED
SYSTEM_RECOVERY_REQUIRED
SECURITY_APPROVAL_REQUIRED
DEFERRED
```

System, runner, state, Git and environment failures must use `SYSTEM_RECOVERY_REQUIRED`; they cannot be converted into user business questions.

## Entity boundaries

- **Project** describes a repository and selected profile, not business implementation details.
- **Workflow** represents one delivery goal and owns the current phase/status pointer.
- **Workstream** preserves responsibility, Session and Workspace continuity across Initial, Repair and Recheck.
- **Task** is the smallest independently verifiable scheduled unit.
- **Attempt** is one Initial/Repair/Recheck/Reverify execution of a Task.
- **Run** is a concrete process execution and uses an idempotent execution key.
- **Session** is the Agent conversation/process identity.
- **Workspace** is the isolated write environment.
- **Gate Result** is a deterministic delivery decision, not an Agent self-declaration.
- **Issue** has one Primary Owner, Evidence, Expected Fix and Required Recheck.
- **Artifact** has one ACTIVE version per logical key; prior versions are preserved.
- **Evidence** proves an action or result and is immutable by hash.
- **Acceptance** records real Product or User decisions bound to a baseline.

## Compatibility rule

Project-specific vocabulary is translated at the adapter boundary. For BossResume, `adapters/bossresume-contracts.mjs` currently maps:

```text
PASS    → APPROVED
FAIL    → FAILED
BLOCKER → BLOCKING
TESTING → SYSTEM_TEST
```

Core contracts contain no BossResume project ID, PRD path, business entity, project phase or checkpoint wording.

## Validation rule

Every runtime write must follow this order:

```text
Adapter translation when required
→ JSON Schema validation
→ Domain invariant validation
→ persistence
→ audit Event
```

Invalid Agent output enters `OUTPUT_CONTRACT_ERROR`; it must not mutate Workflow or Task state.