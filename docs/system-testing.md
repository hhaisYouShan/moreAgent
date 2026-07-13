# Stage 6 system testing

```yaml
status: in-progress
version: 1.0
updated_at: 2026-07-14
stage: 6
validation_target: synthetic-project
bossresume_allowed: false
```

Stage 6 proves that AI Software Company OS can deliver a project lifecycle reliably before any real BossResume execution begins.

## Test pyramid

```text
Schema and Domain contracts
→ Control Plane units and properties
→ Execution Plane integration
→ Evidence/Integration/Release operations
→ Full synthetic project lifecycle
→ Failure injection and recovery
→ Stage 7 entry review
```

## Synthetic lifecycle

`test/system-e2e.test.mjs` runs a project with no BossResume vocabulary or business rules through:

```text
INTAKE
→ PRODUCT_DESIGN
→ MULTI_ROLE_REVIEW
→ TECHNICAL_DESIGN
→ TASK_PLANNING
→ DESIGN_GATE
→ IMPLEMENTATION
→ parallel Task execution
→ dependent integration Task
→ REVIEW
→ real Git Integration Evidence
→ SYSTEM_TEST
→ TEST_GATE
→ PRODUCT_ACCEPTANCE
→ PRODUCT_ACCEPTANCE_GATE
→ USER_ACCEPTANCE
→ USER_ACCEPTANCE_GATE
→ RELEASE
→ health checks
→ MAINTENANCE
```

It verifies:

- Project, Workflow, Task, Gate, Acceptance and Evidence contracts.
- A deterministic DAG with two parallel Tasks and one dependent Task.
- Policy, Lock, Session and Workspace boundaries.
- Real Integration Commit semantics through the Git integration interface.
- Product and User Acceptance bound to the Integration Commit.
- Release and health-check evidence.
- Complete Requirement Trace.
- Immutable Workflow snapshots and unique event idempotency keys.

## Failure injection

`test/system-resilience.test.mjs` verifies:

- A duplicate concurrent execution cannot acquire the same resource.
- Secret paths, unauthorized tools, budget overflow and Auto mode are rejected before Workspace or Runner creation.
- Forty generated acyclic DAGs remain valid and an injected cycle is rejected.
- Event replay is idempotent and corrupted base state is rejected.
- Expired locks and stale Sessions are detected.
- Side-effect-free Runs can create a new Attempt.
- Runs with committed side effects remain blocked until deterministic reconciliation.

Existing lower-level suites also cover:

- process timeout and cancellation;
- output contract failure and retained repair Workspace;
- Artifact supersede history;
- integration conflicts without fake commits;
- health-check failure with rollback and Incident creation;
- evidence-gated continuous maintenance.

## Required CI matrix

Stage 6 must pass on:

- Node.js 20.x;
- Node.js 22.x;
- syntax verification;
- documentation and program-status verification;
- contract verification;
- Control Plane verification;
- Execution Plane verification;
- Evidence and Operations verification;
- system end-to-end verification;
- system resilience verification;
- complete regression suite.

## Stage 6 exit criteria

Stage 6 is `COMPLETED` only when:

1. All CI matrix jobs pass against the current `main` commit.
2. The synthetic lifecycle reaches `MAINTENANCE` with complete Trace and no open Blocking/Major system issue.
3. Duplicate active execution is deterministically rejected.
4. Recovery does not replay committed side effects.
5. Security, permission, scope and budget guards run before external execution.
6. The BossResume Stage 7 entry checklist is approved.

Until these conditions are evidenced, `validation/bossresume/` remains inactive.