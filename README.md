# MoreAgent

MoreAgent is a project-agnostic control plane for multi-agent software delivery. It owns orchestration contracts, state-source diagnostics, run/session lifecycle, worktree isolation, Gate evaluation, recovery, and audit. It does not own a consumer project's business PRD, business code, or user acceptance decision.

## Current migration slice

The first portable slice is read-only state-source inspection:

```bash
npm run verify
node src/cli.mjs state inspect \
  --project /path/to/project \
  --adapter adapters/bossresume.json
```

The adapter contains project-specific paths, field mappings, and M0 wording. The core contains no BossResume-specific path or product name.

## Boundary

```text
MoreAgent Core -> Project Adapter -> Consumer Project
```

- Core: generic contracts and execution engine.
- Adapter: project paths, roles, allowed Gate mapping, and project-specific checkpoint policy.
- Consumer Project: PRD, business code, business acceptance, and final merge authority.

BossResume is the first compatibility project. Its existing Agent Loop remains active during dual-run validation; MoreAgent does not replace its entrypoint until the diagnostics, Gate, and lifecycle contracts reach parity.
