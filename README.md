# MoreAgent — AI Software Company OS

MoreAgent is building an **AI Software Company OS**: a deterministic software-delivery control plane that manages non-deterministic agents.

Users provide a business goal, requirements or PRD, a code repository, project standards, and constraints. The system follows a real software-company delivery process:

```text
Requirements clarification
→ Product design
→ Multi-role review
→ Technical design
→ Task DAG
→ Development and self-test
→ Review
→ Integration
→ System test
→ Product acceptance
→ User acceptance
→ Release and rollback
→ Continuous maintenance
```

Multi-agent execution is only one implementation mechanism. The product is the control system around it: Workflow, contracts, Task DAG, scheduling, permissions, evidence, Gates, recovery, integration, release, and maintenance.

## Current program

The authoritative implementation roadmap contains nine stages:

1. Repository structure and documentation source-of-truth cleanup.
2. Stabilize Domain and Schema Contracts.
3. Complete the Control Plane.
4. Complete the Execution Plane.
5. Complete Evidence, Recovery, Integration, Release, and Maintenance.
6. Complete system-level testing.
7. Run the first real-project validation with BossResume.
8. Correct the OS based on validation findings.
9. Validate generality with a second, different project.

See [`docs/roadmap.md`](docs/roadmap.md).

## Boundary

```text
AI Software Company OS Core
        ↓
Project Profiles and Adapters
        ↓
Consumer Project
```

- **Core** owns project-agnostic Workflow, Task, Gate, Issue, Artifact, Run, Session, Recovery, Integration, Audit, and policy contracts.
- **Profiles and adapters** describe project paths, technology stacks, commands, Agent capabilities, workflow policies, and acceptance rules.
- **Consumer projects** own business PRDs, business code, product decisions, and final user acceptance.

BossResume is not the current delivery target. It is the first real-project validation target after the OS reaches Stage 6.

## Documentation

- [`docs/README.md`](docs/README.md): documentation authority and source-of-truth rules.
- [`docs/architecture.md`](docs/architecture.md): target repository and system architecture.
- [`docs/roadmap.md`](docs/roadmap.md): nine-stage implementation roadmap and completion criteria.
- [`docs/migration-ledger.md`](docs/migration-ledger.md): BossResume compatibility-engine extraction status.

## Current code

The current portable core includes state-source inspection, reconciliation, contracts, lifecycle primitives, planning guards, and an orchestration shell. The migrated BossResume Agent Loop remains a compatibility reference until equivalent capabilities are implemented and validated in the generic core.

```bash
npm run verify
node src/cli.mjs state inspect \
  --project /path/to/project \
  --adapter adapters/bossresume.json
```
