# Execution Plane

```yaml
status: implementation-in-progress
version: 1.0
updated_at: 2026-07-13
stage: 4
```

The Execution Plane performs work approved by the Control Plane. It does not decide Workflow transitions, Gate conclusions, business scope, or user acceptance.

## Components

| Component | Responsibility |
|---|---|
| `Runner Registry` | Select replaceable runners by ID and capability |
| `Local Process Runner` | Headless process execution, stdout/stderr, timeout and cancellation |
| `OpenCode/Codex adapters` | Translate Task and Context into tool-specific invocation |
| `tmux/Warp adapters` | Wrap execution in terminal sessions without leaking terminal semantics into Core |
| `Session Manager` | Create, resume, heartbeat, idle, stale and close Agent sessions |
| `Workspace Manager` | Create, use, retain and release isolated workspaces |
| `Git Worktree Provider` | Provide one task branch/worktree per controlled workspace |
| `Task Executor` | Apply Policy, acquire Locks, manage heartbeat, call Runner, validate result and clean resources |

## Execution sequence

```text
Approved READY Task
→ Task Policy validation
→ Runner selection
→ Lock/Lease acquisition
→ Workspace creation
→ Session create/resume
→ Runner execution
→ Heartbeat and output events
→ Agent Result validation
→ Session and Workspace finalization
→ Lock release
→ Run/Attempt Result
```

## Hard boundaries

- Core does not invoke OpenCode, Codex, tmux or Warp directly.
- Every execution has a stable `executionKey` and unique Run/Attempt identity.
- No write starts before editable paths, forbidden paths, tools, Context and budget pass Policy.
- A multi-resource lock acquisition is atomic.
- Cancellation and timeout are explicit terminal states.
- An invalid Agent Result becomes `OUTPUT_CONTRACT_ERROR`; it cannot mutate Workflow or Task state.
- Failed workspaces may be retained for repair evidence; successful workspaces are released according to provider policy.
- Integration is not file copying. Task workspaces produce commits consumed by the Stage 5 Integration Service.

## Adapter configuration

Tool command syntax belongs to profiles/adapters because external CLIs can change independently:

- OpenCode supports configurable executable, base arguments and prompt transport.
- Codex supports configurable executable, base arguments, model and output schema arguments.
- tmux provides a stable detached-session wrapper.
- Warp requires an explicit Terminal Profile to supply executable and argument builder instead of guessing a local installation contract.

## Verification

`test/execution-plane.test.mjs` covers:

- Runner replacement for the same Task contract.
- Local process success, timeout and cancellation.
- Session stale/resume/close lifecycle.
- Workspace creation/use/release lifecycle.
- Task execution through Policy, Lock, Session and Workspace boundaries.
- Workspace retention and lock cleanup after invalid Agent output.
- Configurable OpenCode/Codex invocation.
- Injected Git worktree create/release behavior.
