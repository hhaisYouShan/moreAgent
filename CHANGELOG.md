# Changelog

## V1.7.2 (2026-06-30)

### Regression Tests Added
16 regression tests exercising production code via CLI commands:
- **Protocol line parsing** (8 tests): bare + bold `Decision/Result` lines via `status --summary` CLI
- **Result anti-match** (part of protocol): `FAILURES: 0` not FAIL, genuine FAIL detected
- **Pending session filter** (3 tests): full workflow base sessions hidden, architect/started not hidden
- **Merge boundary** (3 tests): real worktree setup, dry-run shows Run/Worktree/Branch, `--apply` rejects dirty main
- **Build** (2 tests): dist exists, CLI `--help` functional

### Changed
- All unit tests replaced with CLI behavioral tests — no production logic replicated in test file
- `CHANGELOG.md` created covering V1.5 through V1.7.2

## V1.7.1 (2026-06-30)

### Fixed
- **Protocol parser**: `matchProtocolLine()` supports bold-wrapped lines (`**Decision: APPROVED**`, `**Result: PASS**`, `**Owner: frontend**`) in addition to bare lines. Updated in `start.ts`, `status.ts`, `inspect.ts`.
- **Result anti-match**: `Result: FAILURES: 0` no longer matches as FAIL. Parser uses `\S+` word capture, callers check exact values. Note: `FAILURES: 0` is treated as `unknown` (not FAIL and not PASS) — the parser only recognizes exact `Result: PASS` and `Result: FAIL` lines. This is by design: "0 failures" does not guarantee "all tests passed".
- **Merge dry-run**: Main project dirty check moved to `--apply` only. Dry-run always outputs run info, worktree diff, and merge readiness.
- **Pending session filter**: `isHiddenFullWorkflowPending()` hides full workflow base sessions (frontend/backend/product) when phase alias sessions exist and base session is pending-without-startedAt. Affects `status --latest-full` summary and session list.
- **Merge apply dirty detection**: Differentiates `.moreagent/` runtime changes from business file changes. Provides targeted error messages.

## V1.7 (2026-06-30)

### Added
- `status --latest-repair`: finds most recent run with repair/retry/revision sessions
- `status --latest-full`: finds most recent full workflow run
- `status --run <id>`: specific run detail
- `status --run <id> --summary`: compact acceptance summary
- `inspect --run <id> --workflow`: workflow phase progress and gate status

## V1.6.1 (2026-06-30)

### Fixed
- Gate repair uses real `agentDir` instead of empty-string path
- `inspect` expanded with full workflow session name matching
- Init output includes `tasks.json` and `runtime-sessions.json`

## V1.6 (2026-06-29)

### Added
- `moreagent merge --latest / --run <id> / --apply`
- Dry-run shows run info, worktree path, branch, diff summary
- Apply merges committed branch only, refuses dirty worktree
- Run type extended with `mergedAt`, `mergedBranch`, `mergeCommit`

## V1.5.1 (2026-06-29)

### Fixed
- `failure-analysis.md` default Owner changed from `frontend` to `unknown`
- `runProductRepairGate()` and `runTechPlanRepairGate()` re-run through proper gate
- Owner assignment rules enforced in brain prompt

## V1.5 (2026-06-29)

### Added
- Full workflow tester/reviewer failure attribution + targeted repair
- `failure-analysis.md` with Owner protocol
- `evaluateArtifactDecisionForFile()` with pattern-based file matching
- Max 2 repair rounds per test/review failure

## V1.4.2 (2026-06-29)

### Fixed
- PRD Gate and Tech Gate multi-round revision logic restored in `executePhases`
- 12 new artifact templates for revision gate documents

## V1.4.1 (2026-06-29)

### Added
- `--resume --latest / --resume --run <id>` for full workflow recovery
- `--from-phase <phase>` to start from a specific phase
- Phase-level checkpoint in `WorkflowInfo.completedPhases`
- `status --latest` shows workflow progress

## V1.4 (2026-06-29)

### Added
- Full profile staged workflow with brain/product/frontend/backend/tester/reviewer agents
- 10-phase execution (brain → prd → prd-review → prd-gate → tech-plan → tech-gate → implementation → test → review)
- PRD Gate and Tech Gate with `Decision: APPROVED/CHANGES_REQUESTED`
- `primaryArtifactOverride` in `executeAgentSession`

## V1.3 (2026-06-29)

### Added
- Configurable agent artifacts via `AgentConfig.primaryArtifact`
- `init --profile mvp` and `init --profile full`
- Full profile with product/frontend/backend/tester/reviewer
- 7 new artifact templates for full workflow

## Earlier Versions

See git history for V1.0 through V1.2 features including:
- OpenCode native session integration
- tmux visualization
- Queue recovery and retry
- Start --loop task queue
- Sessions management
- Merge command
- Status query enhancements
