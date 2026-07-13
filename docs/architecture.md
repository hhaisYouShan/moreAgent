# MoreAgent architecture

## Product role

MoreAgent is the reusable delivery control plane. It must be able to operate against many repositories without embedding a customer project's name, PRD path, product phases, or checkpoint text in the core.

## Layers

```text
core/
  state-source inspection, run/session state, worktree lifecycle, Gate contracts
adapters/
  project paths, field mappings, Agent roles, Gate policy, checkpoint wording
consumer project
  PRD, business code, product-specific artifacts, human acceptance
```

## Migration rule

The first migration slice is deliberately read-only. `state inspect` compares the configured Workflow JSON, Markdown presentation, Round Context, current run/task/event pointers, artifact references, and worktree facts. It returns exit code `0` when reconciled and `2` when a split is detected.

The next slices are: generic Reconcile apply, Gate/Issue contracts, worktree lifecycle, Agent runner adapters, and project cutover. Each slice requires a BossResume dual-run comparison before its call site changes.

## M0 policy

M0 is an adapter-level checkpoint policy, not a globally hard-coded Gate type. A project can require a pre-product checkpoint while the core only enforces the generic rule: no product run may start until the adapter's effective approval check passes. M0 wording, result path, project ID, and PRD path belong to the adapter.
