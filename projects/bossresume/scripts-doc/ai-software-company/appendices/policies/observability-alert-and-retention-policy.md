# 可观测性告警与运行数据保留策略

```yaml
status: review
version: 1.1
owner: engineering-operations
last_updated: 2026-07-12
approval_state: pending_independent_recheck
applies_to: AI Software Company OS / BossResume
```

## 1. 目的与适用范围

本策略是 `05-engineering-and-operations.md` 中可观测性章节的可执行补充，定义：

- 什么情况必须触发告警。
- 告警由谁处理。
- 是否允许自动处理。
- 什么情况下需要用户参与。
- 告警如何去重、升级和关闭。
- Workflow、Task、Gate、Release、Agent Log、测试证据和成本数据的保留周期。

本策略属于候选强制工程政策。通过独立 Recheck 并转为 `approved` 后，Dashboard、Alert Manager、Workflow Engine 和运维 Runbook 必须以本策略为准；在 `review` 状态下不得作为 Gate 已通过的依据。

## 2. Alert Contract

每条告警至少包含：

```json
{
  "alertId": "alert-...",
  "alertType": "DUPLICATE_ACTIVE_EXECUTION",
  "severity": "CRITICAL",
  "projectId": "bossresume",
  "workflowId": "wf-...",
  "taskId": null,
  "traceId": "trace-...",
  "triggerCondition": "activeExecutionCount > 1 for same executionKey",
  "evaluationWindow": "immediate",
  "deduplicationKey": "projectId:executionKey:alertType",
  "evidenceArtifactIds": [],
  "impact": "可能重复写入代码或产生重复外部副作用",
  "primaryOwner": "control-plane",
  "autoAction": "PAUSE_NEW_SCHEDULING",
  "userDecisionRequired": false,
  "status": "OPEN",
  "triggeredAt": "...",
  "resolvedAt": null,
  "resolutionEvidenceIds": []
}
```

### 2.1 Severity

| 等级 | 定义 | 默认响应 |
|---|---|---|
| CRITICAL | 可能造成数据丢失、越权、重复副作用、发布事故或流程事实损坏 | 立即停止相关调度或副作用 |
| HIGH | 关键交付链路失败，短期内可能扩大影响 | 自动隔离并通知 Owner |
| MEDIUM | 功能降级、预算风险或局部不一致 | 创建 Issue 并进入修复队列 |
| LOW | 趋势异常或接近阈值 | 记录并观察 |

### 2.2 Alert State

```text
OPEN
→ ACKNOWLEDGED
→ MITIGATING
→ RESOLVED
→ CLOSED
```

误报使用 `SUPPRESSED`，但必须记录抑制原因、期限和批准人。不得直接删除告警。

## 3. 高优先级告警规则

| Alert Type | 触发条件 | Severity | Primary Owner | 自动动作 | 是否需要用户 |
|---|---|---:|---|---|---:|
| DUPLICATE_ACTIVE_EXECUTION | 同一 `executionKey` 存在两个及以上活动 Run | CRITICAL | control-plane | 暂停新调度，冻结重复 Run | 否 |
| WORKFLOW_GATE_STATE_INCONSISTENCY | Workflow State 与最新 Gate Result 不一致 | CRITICAL | control-plane | 进入 RECOVERING，禁止推进 Phase | 否 |
| ARTIFACT_INTEGRITY_FAILURE | Artifact Hash、路径或 Registry 状态校验失败 | CRITICAL | artifact-platform | 阻止下游消费，创建 SYSTEM Issue | 否 |
| HEARTBEAT_LEASE_EXPIRY | 任一活动 Task、Run、Session 或 Workflow Owner 超过配置阈值未上报 Heartbeat，或 Lease 已到期 | HIGH：关键/高风险执行；MEDIUM：普通执行 | runtime-platform | 将执行标记为 STALE，阻止同 executionKey 重复启动并执行 Reconcile | 否 |
| HEARTBEAT_LEASE_MASS_EXPIRY | 同一评估窗口内两个及以上活动执行发生 `HEARTBEAT_LEASE_EXPIRY`，或同一 Worker/Queue 的过期比例超过项目阈值 | CRITICAL | runtime-platform | 暂停相关 Queue 和新调度，执行 Worker/Lock 全量 Reconcile | 否 |
| SECRET_SCAN_HIT | Prompt、Log、Artifact、Commit 或 Test Evidence 命中 Secret | CRITICAL | security | 阻断提交/外发，撤销凭据并隔离证据 | 仅高风险事件通知用户负责人 |
| BUDGET_EXCEEDED | Task/Phase/Workflow/Project 达到 100% 预算 | HIGH | budget-manager | 停止新调度，进入 BLOCKED_BY_BUDGET | 超项目预算时需要 |
| BUDGET_WARNING | 达到 80% 预算 | MEDIUM | budget-manager | 缩小 Context、减少并发、提示 Owner | 否 |
| INTEGRATION_BASE_DRIFT | Integration Base 与目标主分支漂移超过项目阈值 | HIGH | integration | 阻止 Merge，重新计算影响和回归范围 | 否 |
| NON_CONVERGENT_REPAIR | 连续 3 轮 Issue 不下降或达到最大 Repair | HIGH | issue-router | 停止自动 Repair，输出根因报告 | 需要业务取舍时才询问 |
| CRITICAL_TEST_FAILURE | Critical Path、Migration、Security 或 Release Test 失败 | HIGH | test/release | 阻止 Gate 和发布 | 否 |
| RELEASE_HEALTH_FAILURE | 发布后健康检查或关键业务路径失败 | CRITICAL | release | 自动回滚或进入 ROLLING_BACK | 仅回滚策略需决策时 |
| CROSS_PROJECT_DATA_ACCESS | Agent/RAG 访问无权限项目或租户数据 | CRITICAL | security/data | 终止 Session，隔离 Trace | 发生数据事件时通知 |
| PROVIDER_CIRCUIT_OPEN | Provider 连续失败达到熔断阈值 | HIGH | model-runtime | 停止路由至该 Provider，切换兼容备用 | 无兼容备用时形成系统阻塞 |
| BACKUP_RECOVERY_FAILURE | 备份、恢复校验或演练失败 | HIGH | operations | 标记恢复能力降级，停止高风险发布 | 高风险发布时需要 |

### 3.1 Heartbeat 与 Lease 触发规则

- `HEARTBEAT_LEASE_EXPIRY` 面向单个 Task、Run、Session 或 Workflow Owner，是基础告警，不能等待批量故障才触发。
- 触发阈值来自 Task/Session Contract，例如 `heartbeatInterval`、`heartbeatGracePeriod` 和 `leaseExpiresAt`。
- 高风险或 Critical Path 执行一旦过期，Severity 固定为 HIGH；普通执行为 MEDIUM。
- 单实例过期必须先标记 `STALE` 并执行 Reconcile，确认旧执行终止或 Lease 释放前不得创建同 executionKey 的新 Run。
- `HEARTBEAT_LEASE_MASS_EXPIRY` 是聚合升级告警，不替代单实例告警。
- 批量告警必须引用所聚合的单实例 Alert ID，避免丢失 Task 级证据。

## 4. 告警路由与用户参与

### 4.1 默认原则

- SYSTEM、ENVIRONMENT、PARSER、WORKSPACE、LOCK 和确定性测试错误不询问用户。
- 用户只参与业务范围、不可逆数据操作、超总预算、安全/合规高风险和最终发布决策。
- 告警必须先分配 `primaryOwner`，不得广播给所有 Agent 造成重复修复。

### 4.2 升级规则

以下任一情况升级一级：

- 同一告警在 24 小时内重复 3 次。
- 已关闭告警因同一根因重新打开。
- 影响范围从单 Task 扩展到 Phase/Workflow/Project。
- 涉及 Secret、个人信息、生产数据或外部副作用。
- 自动缓解动作失败。
- 单实例 `HEARTBEAT_LEASE_EXPIRY` 在同一 Worker、Queue 或时间窗口聚合成批量故障。

## 5. 去重、抑制与风暴控制

- 相同 `deduplicationKey` 在配置窗口内合并为同一 Alert Incident。
- 告警风暴期间只保留首条、最新状态和聚合计数。
- Suppression 必须设置 `expiresAt`，到期自动恢复评估。
- 不允许通过永久 Suppression 隐藏未修复的 CRITICAL/HIGH 根因。

## 6. 关闭条件

告警只有在满足以下条件时才能 RESOLVED/CLOSED：

- 触发条件已不成立。
- 自动或人工缓解动作有 Evidence。
- 相关 Workflow/Task/Artifact 已完成 Reconcile。
- 必要的回归、恢复或安全验证通过。
- 需要 Incident Review 的告警已创建后续 Task。
- Heartbeat/Lease 告警已证明旧执行不再活动，Lease 已释放或安全接管完成。

Agent 的“已经修复”声明不能单独关闭告警。

## 7. 可观测性运行数据保留

| 数据类别 | V0.1 默认保留 | 目标平台策略 | 说明 |
|---|---|---|---|
| Workflow / Decision / Gate / Release | 项目生命周期，重要决策永久归档 | 永久审计或依法配置 | 不允许因普通清理丢失交付事实 |
| Task / Workstream / Issue / Artifact Metadata | 项目生命周期 | 项目生命周期 + 审计策略 | 正文可归档，元数据保留 Trace |
| Event Store / State Transition | 项目生命周期 | 可重放窗口 + 长期审计聚合 | 必须支持恢复和责任追踪 |
| 原始 Agent Log | 默认 30 天，压缩归档最长 90 天 | 按环境和数据分类配置 | 先脱敏，禁止记录 Secret |
| Tool / Shell / Network Audit | 默认 90 天 | 安全策略要求的审计周期 | 高风险副作用可长期保存 |
| Test Report | 项目生命周期 | Release 生命周期 + 质量策略 | 关键 Gate 证据不得提前删除 |
| 测试视频、截图、浏览器 Trace | 默认保留最近 3 个 Release 或 30 天 | 按 Release/缺陷策略配置 | 含个人信息时缩短并脱敏 |
| Build Artifact | 最近 3 个可回滚 Release | 对象存储生命周期策略 | 至少覆盖回滚窗口 |
| Token / Cost 原始记录 | 90 天 | 原始有限期、聚合长期 | 保留 Project/Model 成本趋势 |
| 聚合 Metrics | 12 个月 | 长期趋势 | 不含敏感原文 |
| Trace Span 原始数据 | 30 天 | 依据容量 7～90 天 | 关键 Incident Trace 转为永久 Evidence |
| Alert / Incident | 项目生命周期 | 安全和审计策略 | 必须保留状态、证据、Owner 和结论 |
| Working Memory | Session 生命周期 | Session 生命周期 | 终止后只保留结构化 Summary |
| Prompt / Model 版本与评估 | 项目生命周期 | 永久版本历史 | 支持回滚和结果复现 |
| Secret / 真实凭据 | 不记录 | 不记录 | 只记录 Secret Reference 和使用事件 |

## 8. Retention 执行规则

- Retention 由数据分类、部署地区、用户删除请求和 Legal Hold 共同决定。
- 用户删除请求必须同步处理主库、文件、对象存储、索引、Embedding 和缓存。
- 审计数据如必须保留，应最小化、脱敏或匿名化，并记录合法/政策依据。
- Source Artifact 被删除或 Hash 变化后，对应 Embedding、Cache 和派生索引必须失效。
- 清理任务必须幂等并产出 Deletion Evidence。

## 9. V0.1 最小落地

BossResume 首次闭环至少实现：

1. 上述 CRITICAL/HIGH Alert Type 和单实例 `HEARTBEAT_LEASE_EXPIRY` 的结构化事件。
2. Dashboard 展示 OPEN Alert、Owner、影响和处理状态。
3. Workflow、Gate、Artifact、Task、Agent Log、Test Evidence 和 Cost 的基础 Retention 配置。
4. Secret 不进入日志和 Artifact。
5. Alert 去重和 Incident 关闭证据。

## 10. 验收标准

- 每个高优先级故障能映射到唯一 Alert Type 和 Owner。
- 单个关键 Task、Run、Session 或 Workflow Owner 的 Heartbeat/Lease 过期可以独立触发告警。
- SYSTEM 告警不会错误要求用户做技术判断。
- CRITICAL 告警触发后相关 Gate 或副作用被阻断。
- Retention 表覆盖交付事实、运行日志、测试附件、成本和告警数据。
- 删除和清理任务有证据，且不会破坏必要审计与恢复能力。