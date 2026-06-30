# Changelog

## V1.9.1 (2026-06-30)

### Added
- **Report boundary hardening**: 6 new regression tests covering edge cases
  - `report --latest --json` returns valid JSON with latest run.id and decision
  - `report --json` defaults to latest (equivalent to `--latest --json`)
  - `report --run missing` non-json shows text error, not JSON
  - full workflow all gates APPROVED => `overallStatus: PASSED`
  - full workflow gate CHANGES_REQUESTED => `overallStatus: FAILED`
  - JSON schema field stability (14 required fields verified)

### Verified
- `report --json` and `report --latest --json` produce identical results
- Full workflow gate logic correctly distinguishes APPROVED/CHANGES_REQUESTED
- Non-json error output maintains backward compatibility
- No code changes needed — all boundary behaviors already correct

## V1.9 (2026-06-30)

### Added
- **`moreagent report`**: standardized workflow report command
  - `report --latest` / `report --run <id>`: text report
  - `report --latest --json` / `report --run <id> --json`: JSON report
- **Decision engine**: `computeDecision()` with 5 overallStatus values and 6 recommendation values
  - `overallStatus`: RUNNING → FAILED → PARTIAL → PASSED → UNKNOWN (priority order)
  - `recommendation`: MERGE_READY / BLOCKED / NEEDS_REPAIR / NEEDS_REVIEW / RUNNING / UNKNOWN
  - `unknown` gate/test/review values never trigger FAILED
  - MERGE_READY requires: PASSED + canMerge + worktree.exists + mainClean
- New `src/commands/report.ts`: all helpers inline, no exports from status.ts
- New `src/output/report.ts`: ReportModel type, printReportText
- 8 report regression tests (MERGE_READY, BLOCKED, NEEDS_REPAIR, PARTIAL, RUNNING, repairRounds, not found, text)
- computeDecision gate checks limited to full workflow runs (MVP runs skip prdGate/techGate)
- countRepairRounds implements real round detection from session names

### Design
- `buildReport()` reads directly from `Run`, artifact markdown files, and `git status`
- All 7 helpers (getGateSummary, checkCanResume, checkCanMerge, getWorktreeInfo, etc.) inline in report.ts
- No dependency on V1.8 buildRunSummary

## V1.8.1 (2026-06-30)

### Fixed
- **JSON error hardening**: `exitWithError()` helper ensures all `--json` error paths output valid JSON (not text). Replaced 9 `console.error + process.exit(1)` calls in `cli.ts` with unified `exitWithError(message)` that checks `--json` flag.
- **`inspect --workflow --json`** on non-full workflow runs now returns `NOT_FULL_WORKFLOW` error JSON instead of rendering text.
- **Error codes added**: `BAD_ARGS` (CLI argument errors), `NOT_FULL_WORKFLOW` (inspect --workflow on non-full run).
- 4 new boundary JSON tests: empty sessions, unknown command, start --resume without --run, inspect --workflow on non-full run (30 total).

## V1.8 (2026-06-30)

### Added
- **JSON output**: `status --json` / `inspect --json` for machine consumption
  - `status --json`: list mode `{ runs: [...] }`
  - `status --latest --json`: single run `{ run: {...} }`
  - `status --run <id> --summary --json`: compact summary
  - `inspect --run <id> --json`: run overview
  - `inspect --run <id> --workflow --json`: workflow detail
- **Error JSON**: all `--json` errors output `{ error: { code, message } }` with exit 1
- **Error codes**: NO_RUNS, RUN_NOT_FOUND, NO_REPAIR_RUN, NO_FULL_RUN, NOT_INITIALIZED, INTERNAL_ERROR, UNSUPPORTED_JSON_MODE
- **durationSeconds**: `number | null` in JSON (text keeps `32s` / `N/A`)
- New `src/output/json.ts`: `printJson`, `printJsonError`, `isJsonMode`
- 10 JSON-specific regression tests

### Design
- `buildRunSummary`/`buildRunDetail`/`buildRunListItem`/`buildRunOverview`/`buildWorkflowModel` extract pure data from rendering functions
- Text and JSON share the same data model, rendered independently
- `cli.ts` top-level catch handles JSON error output

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
