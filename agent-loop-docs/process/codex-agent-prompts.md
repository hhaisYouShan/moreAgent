# bossResume Codex Agent Prompts

当前正式提示词已经迁移到终端 Agent Loop：

```text
scripts/agent-loop/agents/
```

本文件只保留索引，不再维护旧的 `docs/refactor-prd.md` 口径提示词。当前正式 PRD 入口是：

- `docs/prd/bossresume-full-refactor-prd.md`
- `agent-loop-docs/prd-addendums/bossresume-full-refactor-prd-v1.2-agent-workflow-addendum.md`

当前 Agent Loop 运行态和流程规范入口是：

- `agent-loop-docs/README.md`
- `agent-loop-docs/process/agent-registry.md`
- `agent-loop-docs/process/gate-matrix.md`
- `agent-loop-docs/process/brain-loop-protocol.md`
- `agent-loop-docs/process/prd-review-standard.md`

## Agent 提示词索引

| Agent | Prompt 文件 |
|---|---|
| `brain_agent` | `scripts/agent-loop/agents/brain-agent.md` |
| `product_agent` | `scripts/agent-loop/agents/product-agent.md` |
| `ui_agent` | `scripts/agent-loop/agents/ui-agent.md` |
| `frontend_architect_agent` | `scripts/agent-loop/agents/frontend-architect-agent.md` |
| `backend_architect_agent` | `scripts/agent-loop/agents/backend-architect-agent.md` |
| `frontend_agent` | `scripts/agent-loop/agents/frontend-agent.md` |
| `backend_agent` | `scripts/agent-loop/agents/backend-agent.md` |
| `test_agent` | `scripts/agent-loop/agents/test-agent.md` |
| `review_agent` | `scripts/agent-loop/agents/review-agent.md` |
| `repair_agent` | `scripts/agent-loop/agents/repair-agent.md` |

## 通用运行方式

由执行器自动拼接角色提示词和当前任务：

```bash
npm run agent:loop:dry-run
npm run agent:loop
```

如需手动运行单个 Agent，可参考执行器生成的 `.agent-runs/{run-id}/{task-id}/prompt.md`。

## 通用硬规则

1. 所有 Agent 必须读取 `AGENTS.md`、`docs/README.md` 和 `agent-loop-docs/process/agent-registry.md`。
2. 所有 Agent 必须以正式 PRD 为最高产品约束。
3. 需求不清必须输出 `BLOCKED` 并向用户提问。
4. 每个输出文件末尾必须包含 Self Check。
5. 每个 Agent 必须输出 `agent-loop-docs/gate-results/*.json`。
6. 未通过 Gate 前，不允许进入下一阶段。
7. 业务代码阶段必须使用 git worktree 隔离。
