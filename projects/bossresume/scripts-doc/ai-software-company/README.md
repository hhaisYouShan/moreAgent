# AI Software Company OS 文档集

> 状态：Draft v0.2-r7
> 当前验证项目：BossResume
> 最终目标：建设一套通用 AI 软件公司

## 1. 文档定位

本目录定义多 Agent 软件交付平台的产品目标、系统架构、Agent 核心机制、数据与知识工程、工程运维保障和项目演进路线。

当前只验证：

```text
docs/prd/bossresume-full-refactor-prd.md
```

BossResume 完整交付后，再提取通用控制面到独立仓库。

## 2. 六个主模块

| 文档 | 职责 |
|---|---|
| [`01-business-and-product.md`](./01-business-and-product.md) | 产品目标、范围、场景、人机边界、产品/用户验收 |
| [`02-architecture-and-system-design.md`](./02-architecture-and-system-design.md) | 架构、正式 Phase、控制面、状态和恢复 |
| [`03-agent-core-mechanisms.md`](./03-agent-core-mechanisms.md) | Agent、权限、Task、Workstream、Session、Prompt 和模型 |
| [`04-data-and-knowledge-engineering.md`](./04-data-and-knowledge-engineering.md) | 数据契约、Artifact、Project Map、Memory、RAG 和 Trace |
| [`05-engineering-and-operations.md`](./05-engineering-and-operations.md) | Test、Integration Evidence、Release/Rollback、安全、成本、可观测性和容灾 |
| [`06-project-management-and-evolution.md`](./06-project-management-and-evolution.md) | BossResume A～F/M0～M13 路线、正式 Gate 映射和演进 |

Git 历史保留旧版本。被当前版本替代的完整文档快照放在 `appendices/history/`，不得作为第二套当前事实源。

## 3. 当前正式 Gate

唯一权威：

```text
agent-loop-docs/process/gate-matrix.md
```

当前正式 Gate：

```text
PRD_GATE
ARCHITECTURE_GATE
UI_GATE
DESIGN_GATE
TEST_GATE
PRODUCT_ACCEPTANCE_GATE
USER_ACCEPTANCE_GATE
ARCHIVE_GATE
```

规则：

- M0 是 `M0 Baseline Checkpoint`，不是正式 Gate。
- Task DAG 设计完整性由 `DESIGN_GATE` 检查。
- 控制面实现、Implementation、Review、Repair 和 Integration Evidence 由 `TEST_GATE` 检查。
- Release、Migration、Health Check 和 Rollback 是 `ARCHIVE_GATE` 前置证据。
- 未来新增 gateType 前必须同步 Gate Matrix、Schema、Workflow、代码和测试。
- 未注册术语不得用于当前状态推进。

## 4. Workflow 与 M0

### 4.1 Workflow Phase

正式 Phase 闭集：

```text
INTAKE
PRODUCT_REVIEW
PRD_REVIEW
ARCHITECTURE_IMPACT_REVIEW
ARCHITECTURE_DESIGN
ARCHITECTURE_REVIEW
UI_DESIGN
DEVELOPMENT_DESIGN
DESIGN_REVIEW
IMPLEMENTATION
TESTING
PRODUCT_ACCEPTANCE
USER_ACCEPTANCE
ARCHIVE
```

### 4.2 M0 合同

- 合同：[`m0-baseline-checkpoint-contract.md`](../../../agent-loop-docs/process/m0-baseline-checkpoint-contract.md)
- Result：`agent-loop-docs/checkpoints/{feature_key}-m0-baseline-checkpoint.json`
- 唯一批准值：`APPROVED`
- 只有 `effectiveApproval=true` 才能启动 Product Agent。

Product 前置 Guard 已接入 Agent Loop Preflight。真实运行前会检查 Result、Base SHA、Evidence、Single/Auto、Scope Guard、Verification 和 OPEN Issue。

## 5. State Reconcile

当前完整审核发现本地存在 `state_source_split`。使用：

```bash
npm run agent:reconcile
```

该命令只读诊断，不写文件。

确认后执行：

```bash
npm run agent:reconcile -- --apply
```

可选清理 Git 标记为 prunable 的 Worktree：

```bash
npm run agent:reconcile -- --apply --prune-worktrees
```

Reconcile 行为：

1. 读取 Workflow、Current Run/Task/Event、Artifact 引用和 Worktree。
2. 保存旧运行指针到 `.agent-runs/reconciled/<timestamp>/`。
3. 生成 Reconciliation Artifact。
4. 使用统一写入函数设置 `BLOCKED_BY_SYSTEM / state_source_split`。
5. 重置 Current Run/Task/Event 为 IDLE。
6. 不创建 M0 Result，不启动 Product Agent。

Reconcile 完成不等于 M0 通过。

## 6. 机器契约与附件

### `agent-loop-docs/process/`

- `gate-matrix.md`：正式 Gate 唯一权威。
- `workflow-state.json`：实时 Workflow 状态。
- `workflow-state.md`：人类可读状态。
- `m0-baseline-checkpoint-contract.md`：M0 Result 合同。

### `schemas/`

当前 Schema：

- `task.schema.json`
- `agent-result.schema.json`
- `artifact.schema.json`
- `issue.schema.json`
- `gate-result.schema.json`
- `event.schema.json`

### `appendices/`

- [`bossresume-delivery-stage-tracker.md`](./appendices/bossresume-delivery-stage-tracker.md)：A～F/M0～M13 进度台账。
- [`document-change-log.md`](./appendices/document-change-log.md)：文档变更。
- [`adr-register.md`](./appendices/adr-register.md)：架构决策。
- [`terminology.md`](./appendices/terminology.md)：术语。
- `policies/`：强制政策候选/批准版本。
- `contracts/`：跨模块合同。
- `reviews/`：Review/Gate 历史。
- `history/`：被当前版本替代的只读快照。

## 7. Policy 状态

| status | 含义 | 可用于 Gate |
|---|---|---:|
| draft | 初稿 | 否 |
| review | 候选规则，等待独立验收 | 否 |
| approved | 已由独立 Artifact 批准 | 是 |
| superseded | 被新版本替代，只读历史 | 否 |

`review` 不能被描述为已生效。

## 8. 事实源边界

| 内容 | 事实源 |
|---|---|
| 产品目标与范围 | 01 |
| 架构和 Phase | 02 |
| Agent/Task/Session | 03 |
| 数据/Artifact/Trace | 04 |
| Test/Integration/Release Evidence | 05 |
| 项目路线和版本 | 06 |
| 正式 Gate | Gate Matrix |
| M0 | M0 Contract + Result |
| 当前阶段 | Stage Tracker |
| 实时运行 | Workflow + Current Run/Task/Event |
| 业务需求 | BossResume PRD |
| 代码事实 | Git Commit/Branch/PR |

优先级：

```text
Approved ACTIVE Artifact / Approved Policy
> Confirmed Decision
> Valid Project Map
> Approved Long-term Memory
> Working Memory
> Agent Inference
```

聊天摘要不能覆盖运行事实。

## 9. 推荐阅读顺序

```text
01
→ 02
→ 03
→ 04
→ 05
→ 06
→ Gate Matrix / Workflow / M0 Contract
→ Stage Tracker
→ Policy / Schema / ADR / Review
```

## 10. 当前实施原则

- 当前只验证 BossResume。
- Single 是唯一允许模式。
- Auto 保持 OFF。
- Brain Agent 不写业务代码。
- Developer 不写 master。
- Agent 不推进 Workflow State。
- M0 `effectiveApproval=false` 时禁止 Product Agent、PRD 修改和业务代码开发。
- 系统问题进入 `BLOCKED_BY_SYSTEM`，不询问用户业务决策。
- 文档描述不代表实现完成。
- PR #30 在 Codex 完整审核通过前保持 Draft。
