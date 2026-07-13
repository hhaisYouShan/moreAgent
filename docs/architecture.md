# AI Software Company OS architecture

## 1. Product architecture

```text
User / Project Owner
        ↓
Interaction and Decision Layer
        ↓
Control Plane
        ↓
Execution Plane
        ↓
Evidence and Knowledge Plane
        ↓
Consumer Repository and Environments
```

### Control Plane

Owns deterministic decisions:

- Workflow state and legal transitions.
- Product and technical delivery stages.
- Task DAG generation and validation.
- Scheduler, dependency, concurrency, and resource decisions.
- Gate evaluation and Issue routing.
- Policy, permission, budget, and capability guards.
- Checkpoint, reconciliation, and recovery decisions.

### Execution Plane

Performs controlled work:

- Agent runtime and model/tool adapters.
- Session and workspace lifecycle.
- Worktree or container isolation.
- Development, self-test, Review, and repair execution.
- Git integration and conflict handling.
- Test runner, release, rollback, and maintenance jobs.

### Evidence and Knowledge Plane

Proves what happened and provides bounded context:

- Artifact Registry.
- Requirement Trace.
- Project Map and drift detection.
- Context Manifest and input hash.
- Command, test, integration, release, and rollback evidence.
- Event log, audit, cost, and retrospective knowledge.

## 2. Repository target structure

```text
moreAgent/
├── src/
│   ├── domain/              # stable project-agnostic entities and value objects
│   ├── control-plane/       # workflow, planner, scheduler, gates, issues, recovery
│   ├── execution-plane/     # agents, runners, sessions, workspaces, integration, release
│   ├── evidence-plane/      # artifacts, trace, project map, context, audit
│   ├── infrastructure/      # git, filesystem, process, storage, logging
│   ├── adapters/            # tool, model, terminal, storage and project adapters
│   ├── cli/                 # public command entrypoints
│   └── shared/
├── schemas/                 # JSON Schema runtime contracts
├── profiles/                # workflow, agent, policy, capability and acceptance profiles
├── validation/              # real-project validation packs; BossResume enters at Stage 7
├── legacy/                  # compatibility source retained during extraction
├── test/
│   ├── unit/
│   ├── contract/
│   ├── integration/
│   ├── recovery/
│   └── e2e/
├── docs/
└── scripts/
```

The directory migration is incremental. Existing `src/core`, `src/contracts`, `src/runtime`, `scripts/agent-loop`, `agent-loop-docs`, and `projects/bossresume` remain until their responsibilities are moved and parity tests pass.

## 3. Dependency rules

```text
domain
  ↑
control-plane ← evidence-plane contracts
  ↑
execution-plane
  ↑
infrastructure and adapters
```

Rules:

- `domain/` cannot depend on tools, models, terminals, Git, BossResume, or storage implementations.
- Control Plane cannot call a concrete runner directly; it uses execution interfaces.
- Agents cannot write Workflow State, advance phases, or approve Gates.
- Project adapters cannot change core state semantics.
- Consumer-project business files stay outside the OS core.
- Compatibility code cannot become a second public entrypoint after its capability is switched to Core.

## 4. Public execution lifecycle

```text
Intake
→ Product workflow
→ Technical workflow
→ Validated Task DAG
→ Controlled execution
→ Independent Review
→ Git Integration
→ System verification
→ Product acceptance
→ User acceptance
→ Release / rollback
→ Monitoring, repair, change intake, and continuous maintenance
```

Every transition must be supported by structured input, deterministic checks, accessible evidence, and an auditable event.

## 5. Migration rule

Migration proceeds capability by capability:

```text
REFERENCE
→ EXTRACTING
→ DUAL_RUN_PASS
→ SWITCHED
→ DELETABLE
→ REMOVED
```

A compatibility capability may switch to Core only after its project-agnostic contracts, tests, and parity evidence pass. BossResume-specific paths, wording, PRDs, and workflow state remain in profiles, adapters, validation material, or the BossResume repository; they do not enter Core.
