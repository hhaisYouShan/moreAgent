# Evidence and Operations Plane

```yaml
status: implementation-in-progress
version: 1.0
updated_at: 2026-07-13
stage: 5
```

Stage 5 closes the delivery loop after Task execution. Completion is based on immutable evidence and real Git/release effects, never Agent self-declaration.

## Evidence components

- **Artifact Registry**: versioned logical artifacts with at most one `ACTIVE` version; history is superseded, never overwritten.
- **Event Store**: append-only and idempotent by `idempotencyKey`.
- **Project Map**: repository structure bound to a Base Commit and hash.
- **Requirement Trace**: Requirement → Design → Task → Commit → Test → Gate → Acceptance.
- **Context Manifest**: task-minimal files, hashes, Artifacts, Decisions, write boundaries and budget.
- **Atomic JSON Store**: crash-safe replacement writes, immutable records and path-escape protection.

Project Map changes invalidate old Context Manifests. Old Context or Evidence cannot be reused against a different baseline without an explicit new version.

## Integration

```text
Reviewed Task Commits
→ Integration Worktree and Branch
→ git merge --no-ff for every Task Commit
→ Conflict Evidence or Integration Commit
→ Build/Lint/Typecheck/Test/Migration verification
→ Integration Evidence
→ TEST Gate input
```

Hard rules:

- Integration never copies files from a Task Worktree into the main working tree.
- A merge conflict produces conflict files and failed evidence; it does not invent an Integration Commit.
- Verification runs against the resolved Integration Commit.
- TEST Gate evaluates the Integration Commit, not isolated Agent branches.

## Release and rollback

A release requires:

- Approved User Acceptance.
- Acceptance baseline matching the Integration Commit.
- Security/risk approval for high-risk operations.
- Migration, release, health-check and rollback commands with command evidence.

```text
USER Acceptance
→ Migration
→ Release
→ Health Check
→ RELEASED

Failure after side effects
→ Rollback
→ ROLLED_BACK or FAILED
→ Incident Evidence
→ Maintenance intake
```

## Continuous maintenance

Maintenance intake supports Incident, Security, Bug, Performance, Dependency Update, Change Request, Experience and Observability items. Each type has deterministic required evidence, priority, owner role and target phase.

A maintenance workflow cannot be created while required evidence is missing. Maintenance returns work to Product Design, Technical Design or Implementation instead of creating an uncontrolled side channel.

## Verification

`test/evidence-operations.test.mjs` covers:

- Artifact supersede and single ACTIVE version.
- Event idempotency and collision detection.
- Project Map drift and Context invalidation.
- Requirement Trace completeness.
- Atomic/immutable file persistence.
- Successful and conflicting Git integration.
- User-acceptance release guard.
- Health failure rollback and Incident creation.
- Evidence-gated maintenance routing.
