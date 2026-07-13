# M0 Baseline Checkpoint Contract

```yaml
status: draft
version: 1.1
owner: program-management
last_updated: 2026-07-13
checkpoint_type: M0_BASELINE
```

## 1. 目的与权威边界

M0 Baseline Checkpoint 用于正式 Product Workflow 启动前，确定代码基线、运行状态、控制面、工作区、Single/Auto 能力和验收证据是否可信。

M0 不是 `agent-loop-docs/process/gate-matrix.md` 注册的正式 gateType：

- 不写入 `agent-loop-docs/gate-results/`。
- 不改变 Gate Matrix。
- 不等价于 `PRD_GATE` 或任何业务 Gate。
- 只决定阶段 B 是否有资格从 `NOT_STARTED` 变为 `READY`。

本合同只定义稳定规则和 Result 结构，**不保存 BossResume 当前状态快照**。当前状态必须实时读取：

1. `agent-loop-docs/process/workflow-state.json`
2. `agent-loop-docs/process/workflow-state.md`
3. `agent-loop-docs/process/round-context.json`
4. `.agent-runs/current-run.json`
5. `.agent-runs/current-tasks.json`
6. `.agent-runs/current-events.jsonl`
7. `git worktree list --porcelain`
8. `scripts/doc/ai-software-company/appendices/bossresume-delivery-stage-tracker.md`

当这些事实源不一致时，必须进入 `BLOCKED_BY_SYSTEM / state_source_split`，不得使用本合同中的示例覆盖实时事实。

## 2. 固定 Result 路径

通用路径：

```text
agent-loop-docs/checkpoints/{feature_key}-m0-baseline-checkpoint.json
```

BossResume 固定路径：

```text
agent-loop-docs/checkpoints/bossresume-full-refactor-m0-baseline-checkpoint.json
```

Result 文件不存在时，事实必须记录为：

```yaml
checkpointArtifactExists: false
checkpointStatus: null
effectiveApproval: false
```

不得创建空文件、示例文件、Draft PR 或 Agent 自我声明来模拟通过。

## 3. 状态闭集

只允许：

```text
DRAFT
IN_PROGRESS
CHANGES_REQUESTED
NEEDS_USER
BLOCKED_BY_SYSTEM
APPROVED
```

| 状态 | 含义 | 阶段 B 是否可 READY |
|---|---|---:|
| `DRAFT` | Result 已建立但检查未开始或未完整 | 否 |
| `IN_PROGRESS` | 正在执行基线核查 | 否 |
| `CHANGES_REQUESTED` | 存在可修复问题 | 否 |
| `NEEDS_USER` | 存在真实业务、范围或风险取舍 | 否 |
| `BLOCKED_BY_SYSTEM` | 工具、Git、Runner、Schema、状态源或环境阻塞 | 否 |
| `APPROVED` | 全部必要条件满足并由批准人确认 | 是 |

禁止使用：

```text
NOT_APPROVED
M0_BASELINE_APPROVED
M0 Gate PASS
Baseline Gate APPROVED
PASS
COMPLETED
```

唯一有效批准值是 `APPROVED`。

## 4. 最小结构

以下 JSON 仅展示字段合同，不代表 BossResume 当前状态：

```json
{
  "schema_version": "1.0",
  "checkpoint_type": "M0_BASELINE",
  "project_id": "bossresume",
  "feature_key": "bossresume-full-refactor",
  "status": "DRAFT",
  "base_branch": "master",
  "base_sha": "",
  "checked_at": "",
  "checked_by": [],
  "approved_by": null,
  "approved_at": null,
  "workflow_snapshot": {
    "workflow_status": "",
    "phase": "",
    "round": 0,
    "gate": "",
    "gate_status": "",
    "current_run_id": null,
    "active_task_ids": []
  },
  "mode": {
    "single": true,
    "auto": false
  },
  "scope_guard": {
    "business_prd_modified": false,
    "business_code_modified": false,
    "brain_has_business_code_write_permission": false
  },
  "state_source_reconciliation": {
    "status": "NOT_CHECKED",
    "evidence_path": "",
    "checked_at": ""
  },
  "evidence_manifest_path": "",
  "verification_results": [],
  "issues": [],
  "open_blocking_count": 0,
  "open_major_count": 0,
  "notes": ""
}
```

## 5. 字段合同

### 5.1 标识与版本

- `schema_version`：固定 `1.0`。
- `checkpoint_type`：固定 `M0_BASELINE`。
- `project_id`：当前固定 `bossresume`。
- `feature_key`：固定 `bossresume-full-refactor`。

### 5.2 状态与批准

- `status`：必须来自状态闭集。
- `checked_at`：带时区 ISO 时间，必须可排序。
- `checked_by`：实际执行核查的人员、Agent 或工具列表。
- `approved_by`：只有 `APPROVED` 时允许非空。
- `approved_at`：只有 `APPROVED` 时允许非空。

### 5.3 基线

- `base_branch`：BossResume 当前必须为 `master`。
- `base_sha`：必须等于本轮实际核查的远端 Master Commit。
- Master 移动后，旧 Result 和 Evidence 自动失效，必须重新核查。

### 5.4 Workflow Snapshot

必须在执行 M0 时从真实状态源生成，不得从本合同、台账或聊天摘要推断。

只有状态源完成对账后，才允许评估以下批准前置条件：

```yaml
workflow_status: READY
phase: INTAKE
round: 0
gate: NONE
gate_status: DRAFT
current_run_id: null
active_task_ids: []
```

这是一组**批准条件**，不是当前 BossResume 状态声明。

如果实时状态是 `BLOCKED_BY_SYSTEM`、存在历史 Current Run、活动 Task、缺失 Artifact、orphan/prunable Worktree 或任何 `state_source_split`，M0 不得 `APPROVED`。

### 5.5 State Source Reconciliation

`state_source_reconciliation` 至少包含：

```json
{
  "status": "RECONCILED",
  "evidence_path": ".agent-runs/reconciled/<timestamp>/reconciliation.json",
  "checked_at": "2026-07-13T00:00:00+08:00"
}
```

规则：

- `status` 只允许 `NOT_CHECKED | SPLIT | RECONCILED`。
- 只有 `RECONCILED` 能参与批准计算。
- `evidence_path` 必须存在，并覆盖 Workflow JSON/Markdown、Round Context、Current Run/Task/Event、缺失 Artifact 和 Worktree。
- 对账完成不等于 M0 通过；它只是 M0 的必要输入。

### 5.6 Mode 与 Scope Guard

- `mode.single` 必须为 `true`。
- `mode.auto` 必须为 `false`。
- `business_prd_modified` 必须为 `false`。
- `business_code_modified` 必须为 `false`。
- `brain_has_business_code_write_permission` 必须为 `false`。

### 5.7 Evidence Manifest

`evidence_manifest_path` 必须指向存在且可访问的不可变证据清单，至少覆盖：

- Master/remote SHA。
- 工作区和未提交差异。
- Worktree、Branch、Integration Worktree。
- 当前进程、窗口、Run、Task、Event、Artifact。
- Workflow Snapshot。
- State Reconcile Artifact。
- Single Preview。
- Auto Guard。
- Brain 权限。
- 验证命令、日志和环境。

### 5.8 Verification Result

每项至少包含：

```json
{
  "verification_id": "",
  "required": true,
  "command": "",
  "cwd": "",
  "exit_code": 0,
  "environment": "",
  "commit_sha": "",
  "log_path": "",
  "executed_at": "",
  "result": "PASS"
}
```

规则：

- `result` 只允许 `PASS | FAIL | BLOCKED | NOT_RUN`。
- required 项目必须全部 `PASS`。
- required 项目 `exit_code` 必须为 `0`。
- `commit_sha` 必须匹配 `base_sha` 或明确记录验证对象。
- 缺少命令、退出码、日志路径、环境、Commit 或时间时结果无效。

### 5.9 Issue

每项至少包含：

```json
{
  "issue_id": "",
  "severity": "BLOCKING",
  "status": "OPEN",
  "decision_type": "AUTO_FIXABLE",
  "owner": "",
  "source": "",
  "problem": "",
  "expected_fix": "",
  "verification": ""
}
```

枚举：

- `severity`：`BLOCKING | MAJOR | MINOR`。
- `status`：`OPEN | CLOSED`。
- `decision_type`：`AUTO_FIXABLE | HUMAN_DECISION_REQUIRED`。

System、Runner、Git、Schema 和状态源问题必须进入 `BLOCKED_BY_SYSTEM`，不得包装成用户业务问题。

## 6. 必需验证范围

M0 至少验证：

1. `master` 与远端 SHA 一致。
2. 工作区干净，或每项差异有明确 Owner 和范围。
3. State Reconcile 为 `RECONCILED`，不存在无法解释的 Current Run、Task、Event、进程、窗口或 Worktree。
4. 所有运行指针引用的 Artifact 存在，或已经以结构化方式 supersede/归档。
5. Workflow JSON、Markdown、Round Context、Run、Task、Event 和 Artifact 一致。
6. 必需文件、Prompt、Policy、Contract 和 Schema 可访问。
7. `doctor`、`status`、`jobs`、日志和 baseline verify 通过。
8. `next --preview --mode=single` 或等价 Single Preview 通过且不产生副作用。
9. Auto 在 CLI、Preview、Orchestrator 和环境变量入口确定性拒绝。
10. Auto 拒绝前不创建 Run、Worktree、Task 或 Agent 进程。
11. Brain Agent 无业务代码写权限。
12. 本轮未修改业务 PRD、前端、后端、数据库或业务测试代码。
13. Evidence Manifest 和必需日志匹配 `base_sha`。

## 7. APPROVED 必要条件

只有同时满足以下条件才允许 `status=APPROVED`：

1. Result 位于固定路径且 JSON 符合合同。
2. `schema_version=1.0`、`checkpoint_type=M0_BASELINE`。
3. `project_id`、`feature_key` 正确。
4. `base_branch=master`，`base_sha` 与远端 Master 完全一致。
5. `state_source_reconciliation.status=RECONCILED`，Evidence 存在。
6. Workflow Snapshot 与对账后的实时事实一致。
7. Snapshot 满足 READY/INTAKE/round 0/NONE/DRAFT/no current run/no active tasks。
8. `mode.single=true`、`mode.auto=false`。
9. Brain 无业务代码写权限，业务 PRD和业务代码未修改。
10. Evidence Manifest 存在、可访问、不可变并匹配 Base SHA。
11. 所有 required Verification 均 `PASS` 且退出码为 0。
12. `open_blocking_count=0`、`open_major_count=0`。
13. `issues[]` 中不存在 OPEN Blocking/Major。
14. `approved_by`、`approved_at`、`checked_at` 完整且时间顺序正确。

任一条件不满足：

```text
阶段 A 不得 COMPLETED
阶段 B 不得 READY
Product Agent 不得启动
业务 PRD不得修改
业务代码不得开发
Auto 保持 OFF
```

## 8. effectiveApproval

```text
effectiveApproval =
  artifactExists
  AND contractValid
  AND status == APPROVED
  AND baseShaMatches
  AND stateSourcesReconciled
  AND workflowSnapshotValid
  AND evidenceValid
  AND requiredVerificationsPass
  AND noOpenBlockingOrMajor
  AND approvalIdentityPresent
  AND singleEnabled
  AND autoDisabled
  AND scopeGuardValid
```

只有 `effectiveApproval=true` 时阶段 B 才能变为 `READY`；仍需由控制面执行显式状态迁移，不得自动启动 Product Agent。

## 9. 反例

以下任一情况均必须使 `effectiveApproval=false`：

- Result 不存在或字段缺失。
- Base SHA 过期。
- Workflow、Current Run/Task/Event 或 Worktree 不一致。
- `state_source_split` 尚未关闭。
- Evidence Manifest 不存在。
- required 命令缺少退出码、Commit、日志或时间。
- 存在 OPEN Blocking/Major。
- Auto 已开启。
- 存在活动 Product Run。
- 批准人或批准时间为空。
- 只有 Markdown 声明、Draft PR、聊天结论或 Agent 自我声明。

## 10. 当前状态引用规则

本合同不再维护易过期的“当前 BossResume 状态”区块。

任何验收者必须实时读取 §1 列出的事实源，并在报告中记录：

- Workflow State。
- Current Run/Task/Event。
- Worktree 和缺失 Artifact。
- M0 Result 是否存在。
- `effectiveApproval` 计算结果。

截至某个 Commit 的状态只能记录在 Stage Tracker、Workflow State、结构化 Issue 或验收报告中，不能写回本合同作为长期事实。
