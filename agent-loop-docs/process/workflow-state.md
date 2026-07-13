# bossResume Workflow State

当前需求：BossResume 前后端整体改造

feature-key：`bossresume-full-refactor`

PRD 路径：`docs/prd/bossresume-full-refactor-prd.md`

项目类型：`existing_refactor`

PRD 修改模式：`review_only`

## 单一状态源

`agent-loop-docs/process/workflow-state.json` 是唯一机器事实源；本 Markdown、dashboard 和 completion-status 都只是展示层。Brain Agent 不允许只改 Markdown 状态；状态迁移必须通过统一写入函数同步 JSON / Markdown / Round Context。

## 压缩 Workflow 状态

- status：`READY`
- step：`PLAN`
- phase：`INTAKE`
- active_agent：`gate_verifier`
- owner_agent：`gate_verifier`
- failure_reason：`null`
- retry_count：`0`

## 兼容旧字段

当前阶段：`INTAKE`

当前轮次：`0`

连续失败次数：`0`

当前 Gate：`NONE`

Gate 状态：`DRAFT`

Issue Owner Agents：`gate_verifier`

## 最近产物

- Issue 记录：`.agent-runs/reconciled/2026-07-13T11-21-41-032Z/reconciliation.json`
- Round Context：`agent-loop-docs/process/round-context.json`
- Workflow JSON：`agent-loop-docs/process/workflow-state.json`
- Audit Events：`agent-loop-docs/process/audit-events.jsonl`

## 待处理问题

- 当前 Gate 尚未执行，需要按下一步指令推进。

## 阻塞问题

- 暂无。

## 下一步应该启动的 Agent

`gate_verifier`

## Issue Owner Tracking

- owner_agents：`gate_verifier`
- source：`.agent-runs/reconciled/2026-07-13T11-21-41-032Z/reconciliation.json`
- rule：Agent 只产出结果；Controller 读取 Verifier 结果后唯一推进 Workflow 状态。
- issue_id_rule：Issue ID 由 issue_signature / decision_topic 稳定生成，同一语义问题不重复询问用户。

## 下一步指令

```text
运行态已对账；仅允许执行 M0 Baseline Checkpoint。effectiveApproval=true 前禁止启动 Product Agent。
```

## 用户日常命令

```bash
npm run agent -- start docs/prd/bossresume-full-refactor-prd.md
npm run agent -- status
npm run agent -- jobs
npm run agent -- logs
npm run agent -- chat
npm run agent -- next --preview
npm run agent -- next --mode=single
npm run agent -- doctor
```

## 支持阶段

```text
INTAKE -> PRODUCT_REVIEW -> PRD_REVIEW -> ARCHITECTURE_IMPACT_REVIEW -> UI_DESIGN -> DEVELOPMENT_DESIGN -> DESIGN_REVIEW -> IMPLEMENTATION -> TESTING -> PRODUCT_ACCEPTANCE -> USER_ACCEPTANCE -> ARCHIVE
new_project 额外包含：ARCHITECTURE_DESIGN -> ARCHITECTURE_REVIEW
```

## 归档路径

- 暂无。
