# MVP Roadmap

## Phase 1: Core Infrastructure (Current)

- [x] Project structure and documentation
- [ ] `moreagent init` — Initialize project with `.moreagent/` directory
- [ ] Config file reading (`config.yaml`)
- [ ] Run directory creation
- [ ] `sessions.json` structure and management
- [ ] `OpenCodeRuntimeAdapter` — basic subprocess call to OpenCode CLI
- [ ] `moreagent start --once --task "xxx"` — Single-run orchestration
- [ ] Artifact generation per agent:
  - `task.md`
  - `brain-plan.md`
  - `implementation-result.md`
  - `test-report.md`
  - `review-report.md`

## Phase 2: Enhancements (Post-MVP)

- [ ] Parallel agent execution
- [ ] Agent-to-agent context passing
- [ ] `moreagent status` — View run/session status
- [ ] `moreagent logs` — View agent output logs
- [ ] Auto-branch naming strategy
- [ ] Custom agent pipelines (configurable execution order)
- [ ] Retry on failure
- [ ] `moreagent resume` — Resume a failed run

## Phase 3: Web Platform (Future)

- [ ] Web dashboard for runs and sessions
- [ ] Real-time log streaming
- [ ] Artifact viewer
- [ ] Configuration UI

## Non-Goals for MVP

- No web platform
- No auto merge or auto push
- No parallel execution
- No database — file-based state only
- No plugin system
