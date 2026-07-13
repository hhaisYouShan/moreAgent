# BossResume 开发阶段与验收进度台账

```yaml
status: active
version: 0.4
owner: program-management
last_updated: 2026-07-13
project_id: bossresume
workflow_feature: bossresume-full-refactor
business_prd: docs/prd/bossresume-full-refactor-prd.md
```

## 1. 目的与事实源

本台账持续记录 BossResume 从控制面基线到最终交付的阶段、准入、产物、验收、目标和当前状态。

本台账不替代：

- 业务 PRD。
- Workflow State、Current Run/Task/Event。
- Gate Matrix 和 Gate Result。
- M0 Checkpoint Result。
- Artifact Registry、Requirement Trace。
- Git Commit、Branch、PR 和 CI。

出现冲突时，先停止推进并执行 Reconcile，不允许用台账文字覆盖运行事实。

## 2. 双层状态与一致性

### 2.1 portfolioStageStatus

```text
NOT_STARTED
READY
IN_PROGRESS
NEEDS_FIX
NEEDS_USER
BLOCKED_BY_SYSTEM
GATE_REVIEW
APPROVED
COMPLETED
ARCHIVED
```

### 2.2 workflowRuntimeState

必须直接抄录正式 Workflow：

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

另外记录：

```yaml
stateSourceConsistency: CONSISTENT | SPLIT | UNKNOWN
currentRunId: null
activeTaskIds: []
gate: NONE
gateStatus: DRAFT
```

`stateSourceConsistency != CONSISTENT` 时：

- `portfolioStageStatus=BLOCKED_BY_SYSTEM`。
- 禁止阶段迁移。
- 禁止 Agent Run。
- 先执行 State Reconcile。

## 3. 正式 Gate 映射

| 阶段 | 里程碑 | 当前正式 Gate/检查 |
|---|---|---|
| P0 | 文档与目标架构基线 | 文档 Commit/Review |
| A | M0 基线 | M0 Baseline Checkpoint，非正式 Gate |
| B | M1 需求收敛 | `PRD_GATE` |
| C | M2～M3 设计收敛 | `ARCHITECTURE_GATE → UI_GATE → DESIGN_GATE` |
| D | M4 最小开发控制面 | `TEST_GATE` |
| E | M5～M10 业务切片 | 每切片独立 `TEST_GATE` |
| F | M11～M13 最终交付 | `TEST_GATE → PRODUCT_ACCEPTANCE_GATE → USER_ACCEPTANCE_GATE → ARCHIVE_GATE` |

规则：

- M0 Result 固定路径：`agent-loop-docs/checkpoints/{feature_key}-m0-baseline-checkpoint.json`。
- Integration Commit/Evidence 是 `TEST_GATE` 输入。
- Release/Migration/Health/Rollback 是 `ARCHIVE_GATE` 前置证据。
- 未注册 gateType 不得用于当前状态推进。

## 4. 当前事实

### 4.1 已确认事实

```yaml
p0:
  portfolioStageStatus: COMPLETED
  openFollowUps: 4

stageA:
  portfolioStageStatus: BLOCKED_BY_SYSTEM
  failureReason: state_source_split

m0:
  checkpointResultPath: agent-loop-docs/checkpoints/bossresume-full-refactor-m0-baseline-checkpoint.json
  checkpointArtifactExists: false
  checkpointStatus: null
  effectiveApproval: false

runtime:
  stateSourceConsistency: SPLIT
  gitWorkflowState:
    workflowStatus: BLOCKED_BY_SYSTEM
    phase: INTAKE
    round: 0
    gate: NONE
    gateStatus: DRAFT
    failureReason: state_source_split
  localCurrentRunObservation:
    workflowStatus: NEEDS_USER
    phase: PRODUCT_REVIEW
    round: 1
    gate: PRD_GATE
    gateStatus: BLOCKED
  missingArtifacts: true
  legacyWorktreeObserved: true

stageBToF:
  portfolioStageStatus: NOT_STARTED

mode:
  single: true
  auto: false
```

### 4.2 解释

- P0 只表示六份主文档和目标架构基线已建立。
- 当前不能无歧义声称“Product Review 从未执行”，因为本地 Current Run 留有 round 1 记录。
- 也不能将该历史 Run 视为有效阶段 B 证据，因为 Decision、Issue、Gate Result 和 Review Artifact 缺失。
- 因此唯一合法结论是 `BLOCKED_BY_SYSTEM / state_source_split`。
- M0 Result 不存在，阶段 B 不具备 READY 条件。

### 4.3 当前下一步

1. 执行只读诊断：`npm run agent:reconcile`。
2. 执行保全与统一写入：`npm run agent:reconcile -- --apply`。
3. 检查 `.agent-runs/reconciled/<timestamp>/reconciliation.json`。
4. 处理缺失 Artifact、orphan/prunable Worktree。
5. 验证 Workflow、Current Run/Task/Event 和 Worktree 一致。
6. 执行 M0 Baseline Checkpoint。
7. 只有 `effectiveApproval=true` 后，阶段 B 才能 READY。

## 5. P0：文档与目标架构基线

### 工作内容

- 建立六份主文档。
- 建立目录、Policy、Contract、Schema、ADR 和 Review 入口。
- 记录 BossResume 当前目标和控制面差距。
- 建立阶段台账和事实源边界。

### 准入条件

无，P0 是前置文档基线。

### 必需产物

- README。
- 六份主文档。
- Document Change Log。
- 相关 PR/Commit。
- 未完成 Policy Recheck 列表。

### 验收标准

- 文档路径存在。
- 模块职责清楚。
- 不把目标能力写成已实现。
- 历史版本由 Git/History 保留。
- Follow-up 独立记录。

### 完成目标

形成可评审的产品/架构目标基线。

### 当前状态

`COMPLETED`，不代表控制面实现或业务交付完成。

## 6. 阶段 A：M0 控制面基线

### 工作内容

- 对账 master/remote、工作区和 Worktree。
- 对账 Workflow、Current Run/Task/Event、Artifact 和进程。
- 验证 Single、Auto Guard 和 Brain 权限。
- 验证 status、jobs、logs、doctor、verify 和 preview。
- 处理 state_source_split。
- 形成 M0 Result 和 Evidence Manifest。

### 准入条件

- P0 完成。
- 仓库和必要工具可访问。
- 禁止业务 PRD和业务代码修改。
- Auto 关闭。

### 必需产物

- State Reconciliation Artifact。
- M0 Result。
- Evidence Manifest。
- Verification Results。
- Issue 清单。
- Worktree 对账结果。
- Base SHA 和 Workflow Snapshot。

### 验收标准

- 状态源一致。
- M0 Result 满足合同。
- `status=APPROVED`。
- `effectiveApproval=true`。
- Base SHA 匹配。
- required Verification 全部 PASS。
- 无 OPEN Blocking/Major。
- Single=true、Auto=false。
- 无活动 Product Run。
- Brain 无业务代码权限。

### 完成目标

形成可信、可复核、可恢复的 Workflow 前置基线。

### 当前状态

`BLOCKED_BY_SYSTEM`。原因：`state_source_split`；M0 Result 不存在。

## 7. 阶段 B：M1 需求收敛

### 工作内容

- Product Initial Review。
- Frontend、Backend、UI、Test 多角色 PRD Review。
- Product Revision。
- 有限 Recheck。
- PRD Gate Decision。

### 准入条件

- 阶段 A `COMPLETED`。
- M0 `effectiveApproval=true`。
- State Source Consistency=CONSISTENT。
- Product Agent Guard 通过。

### 必需产物

- Product Review。
- 多角色 Review。
- PRD Revision。
- PRD Gate Result/Decision。
- Issue 和 Confirmed Decision。
- Requirement IDs。

### 验收标准

- `PRD_GATE=APPROVED`。
- 无 OPEN Blocking/Major。
- 范围、流程、实体、状态机、字段、接口、权限、异常和验收可执行。
- 所有用户决策有记录。
- PRD 可支持设计、开发和测试。

### 完成目标

得到批准的业务范围和验收基线。

### 当前状态

`NOT_STARTED`。历史本地 Product Run 不构成有效产物。

## 8. 阶段 C：M2～M3 设计收敛

### 工作内容

- existing_refactor：Architecture Impact Review。
- new_project：Architecture Design + Architecture Review。
- UI Design。
- Frontend/Backend Development Design。
- Test Design。
- Atomic Task DAG。
- Design Review。

### 准入条件

- `PRD_GATE=APPROVED`。
- PRD 和 Requirement IDs 稳定。
- Current Project Map 可用。

### 必需产物

- Architecture/Impact Artifacts。
- UI Design。
- Frontend/Backend Plan。
- Test Plan。
- Task DAG/Task Contract。
- Review、Issue、Gate Result。

### 验收标准

- `ARCHITECTURE_GATE=APPROVED`。
- `UI_GATE=APPROVED`。
- `DESIGN_GATE=APPROVED`。
- Task DAG 无环、依赖可满足、冲突可管理。
- Migration、Compatibility、Rollback 和 Testability 明确。

### 完成目标

得到可直接进入控制面实现和业务切片的设计基线。

### 当前状态

`NOT_STARTED`。

## 9. 阶段 D：M4 最小开发控制面

### 工作内容

实现 BossResume 首次闭环必需的：

- Project Map/Drift。
- Task DAG Validator。
- Workstream/Session。
- Lock/Lease/Heartbeat。
- Context Manifest。
- Artifact Registry 最小合同。
- Integration Evidence。
- Failure Attribution。
- State Reconcile。
- M0 Guard。
- Single/Auto Capability Guard。

### 准入条件

- 阶段 C 完成。
- 三类设计 Gate 全部 APPROVED。
- Task DAG 和控制面验收命令明确。

### 必需产物

- 控制面代码和测试。
- Task/Context/Session/Artifact 合同。
- State Reconcile 命令。
- M0 Guard。
- Integration Evidence。
- Test Report 和 Gate Result。

### 验收标准

- Build/Typecheck/Lint/Test 通过。
- 重复活动执行为 0。
- 状态源可 Reconcile。
- M0 Guard 能阻止未批准 Product Run。
- 最终 Integration Commit 通过 `TEST_GATE`。
- 无 OPEN Blocking/Major。

### 完成目标

形成最小可靠开发控制面。

### 当前状态

`NOT_STARTED`；本 PR 中只修复阻塞 M0 的 Reconcile/Guard，不代表 M4 整体完成。

## 10. 阶段 E：M5～M10 业务切片

### 准入条件

- 阶段 D 完成。
- 控制面 `TEST_GATE=APPROVED`。
- PRD、Design、Project Map、Trace 和 DAG 可用。
- Session/Lock/Context/Integration 能力可用。

### 统一切片流程

```text
Requirement
→ Impact Analysis
→ Task DAG
→ Task/Workstream Contract
→ Context Manifest
→ Implementation
→ Self Test
→ Independent Review
→ Repair/Recheck
→ Task Commit
→ Integration Commit/Evidence
→ TEST_GATE
→ Requirement Trace Update
```

### 每切片必需产物

- Impact Analysis。
- Requirement Trace。
- Task DAG/Task Contract。
- Context Manifest。
- Agent Result。
- Self Test。
- Review/Recheck。
- Test Report。
- Task Commit。
- Integration Commit/Evidence。
- TEST_GATE Result。
- Risk/Rollback。

### 切片状态

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M5 | Application Domain/Compatibility | NOT_STARTED |
| M6 | Application Management Frontend | NOT_STARTED |
| M7 | AI Prompt Registry | NOT_STARTED |
| M8 | AI Template Test Center | NOT_STARTED |
| M9 | Data Import Center | NOT_STARTED |
| M10 | Navigation/Experience Consolidation | NOT_STARTED |

### 验收标准

- 每个切片独立 `TEST_GATE=APPROVED`。
- 最终 Integration Commit 通过验证。
- Requirement Trace 完整。
- 无 OPEN Blocking/Major。
- Regression 通过。
- 兼容和 Rollback 明确。

### 完成目标

按可独立验收的业务切片完成 PRD 全范围实现。

### 当前状态

`NOT_STARTED`。

## 11. 阶段 F：M11～M13 最终交付

### 工作内容

- 全量 Integration。
- System/Regression/E2E。
- Product Acceptance。
- User Acceptance。
- Release/Migration/Health/Rollback。
- Archive 和 Retrospective。

### 准入条件

- M5～M10 全部完成。
- 每切片 Trace 和 Integration Evidence 完整。
- 无 OPEN Blocking/Major。

### 必需产物

- Final Integration Commit。
- Full Test Report。
- Product Acceptance Result。
- User Confirmation。
- Release Plan/Result。
- Migration/Health Evidence。
- Rollback Plan/Result。
- Archive Snapshot。
- Retrospective/Benchmark。

### 验收标准

- Final `TEST_GATE=APPROVED`。
- `PRODUCT_ACCEPTANCE_GATE=APPROVED`。
- `USER_ACCEPTANCE_GATE=APPROVED`。
- Release Evidence 完整。
- `ARCHIVE_GATE=APPROVED`。
- 用户确认与 feature/task/round/base 绑定。
- 无用户确认不得 Archive。

### 完成目标

完整交付、可回滚、可归档、可复盘的 BossResume。

### 当前状态

`NOT_STARTED`。

## 12. 完成判定

阶段只有同时满足以下条件才能 `COMPLETED`：

1. 本阶段所有正式 Gate/Checkpoint 有效批准。
2. 无 OPEN Blocking/Major。
3. 必需 Artifact 存在并匹配 Base/Input。
4. 验证有命令、退出码、环境、日志、时间和 Commit。
5. 状态源一致。
6. 下一阶段输入准备完成。

以下不能单独作为完成证据：

- Agent 自我声明。
- Markdown 写“通过”。
- 只有编译成功。
- Draft PR。
- 未合并分支。
- 缺失 Artifact 的 Current Run。
- 仅修改台账状态。

## 13. 更新规则

以下事件发生后必须更新台账：

- M0 Result 变化。
- Gate Result 变化。
- Workflow Phase/Status 变化。
- State Reconcile。
- Issue 开关。
- Integration Commit。
- Product/User Acceptance。
- Release/Archive。
- master Base SHA 变化导致证据失效。

每次更新必须记录事实源、Commit、Artifact 和责任人。
