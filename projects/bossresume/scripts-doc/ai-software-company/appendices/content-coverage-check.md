# 文档重组内容覆盖检查

```yaml
status: review
version: 0.2-r4
owner: documentation-review
checked_at: 2026-07-13
scope: scripts/doc/ai-software-company
supersedes: version 0.2-r3
result: PASS_WITH_PENDING_EXTERNAL_RECHECK
```

## 1. 检查结论

**结论：PASS_WITH_PENDING_EXTERNAL_RECHECK。**

六模块重组的内容覆盖、目录结构和唯一事实源边界已经建立；OpenCode 两轮验收提出的内容缺口已完成修订，但四份强制 Policy/Contract 仍保持 `status: review`，不得提前描述为已经批准生效。

本版本纠正三类问题：

1. 初版覆盖检查错误地把 Alert/Retention 标记为完整通过。
2. `0.2-r2` 在 Policy 仍为 `review` 时提前声明 M001～M004 全部 CLOSED。
3. `0.2-r3` 使用未注册的 “Implementation Gate” 术语；当前统一改为正式 `TEST_GATE`。

当前准确状态：

| Finding | 内容修复 | 独立 Recheck | Policy/Contract 状态 | 当前结论 |
|---|---:|---:|---|---|
| M001 Alert/Retention | 已完成 1.1；新增单实例 Heartbeat/Lease 告警 | 待最新 Recheck | review | REMEDIATED_PENDING_RECHECK |
| M002 Citation Contract | 已完成 | 上一轮判定 CLOSED | review | CONTENT_CLOSED_PENDING_APPROVAL |
| M003 高风险独立 Review | 已完成 | 上一轮判定 CLOSED | review | CONTENT_CLOSED_PENDING_APPROVAL |
| M004 跨境决策 | 已完成 1.1；枚举和矩阵已确定化 | 待最新 Recheck | review | REMEDIATED_PENDING_RECHECK |
| M005 Policy 状态冲突 | 已通过 README 和本检查统一状态语义 | 待最新 Recheck | 不适用 | REMEDIATED_PENDING_RECHECK |

只有独立 Recheck 明确通过后，才能把对应文件改为 `approved`、填写 `approved_by`，并产生新的最终 Gate Artifact。

## 2. 旧文档迁移覆盖

| 旧主题 | 新位置 | 结果 |
|---|---|---|
| 产品愿景、用户、痛点、快稳好、范围、指标 | `01-business-and-product.md` | PASS |
| 15 类场景、人机策略、暂停/恢复/取消 | `01-business-and-product.md` | PASS |
| 当前能力、GAP-001～GAP-014 | `02-architecture-and-system-design.md` | PASS |
| 四平面架构、核心组件、Adapter、部署 | `02-architecture-and-system-design.md` | PASS |
| 技术选型与迁移触发条件 | `02-architecture-and-system-design.md` + `appendices/adr-register.md` | PASS |
| 完整交付流程、PRD/Design/Implementation/Acceptance | 01/02/03/05/06 | PASS |
| Workflow/Phase/Task/Issue/Session/Integration/Release 状态机 | `02-architecture-and-system-design.md` | PASS |
| Agent 组织、角色、权限、通信 | `03-agent-core-mechanisms.md` | PASS |
| Task、Workstream、Context、Repair、模型路由 | `03-agent-core-mechanisms.md` | PASS |
| 数据契约、Artifact、Project Map、Trace | `04-data-and-knowledge-engineering.md` | PASS |
| Working/Long-term/Shared Memory、上下文压缩 | `04-data-and-knowledge-engineering.md` | PASS |
| 成本、安全、降级、收敛 | `05-engineering-and-operations.md` | PASS |
| Logs、Metrics、Traces、Dashboard、Benchmark | `05-engineering-and-operations.md` | PASS |
| Alert 与运行数据 Retention | `appendices/policies/observability-alert-and-retention-policy.md` | CONTENT_RESTORED；Policy 1.1 等待独立 Recheck |
| BossResume Profile、Gate、路线和 Auto 条件 | `06-project-management-and-evolution.md` | PASS |
| 历史文档 Gate | `appendices/reviews/document-gate-review-v0.1.md` | PASS |

## 3. 六模块唯一事实源

| 定义 | 唯一位置 | 当前状态 |
|---|---|---|
| 产品、场景、人机边界 | `01-business-and-product.md` | draft 主文档基线 |
| 架构、技术选型、状态机 | `02-architecture-and-system-design.md` | draft 主文档基线 |
| Agent、DAG、Session、Prompt、模型路由概览 | `03-agent-core-mechanisms.md` | draft 主文档基线 |
| 高风险独立 Review 可执行规则 | `appendices/policies/high-risk-independent-review-policy.md` | review 候选规则 |
| 数据契约、Artifact、Memory、RAG 概览 | `04-data-and-knowledge-engineering.md` | draft 主文档基线 |
| Citation 与 Source Verification 输出合同 | `appendices/contracts/citation-contract.md` | review 候选合同 |
| 工程、安全、合规、成本、可观测性和 HA 概览 | `05-engineering-and-operations.md` | draft 主文档基线 |
| Alert/Retention 可执行规则 | `appendices/policies/observability-alert-and-retention-policy.md` | review 1.1，待 Recheck |
| 跨境/第三方数据处理决策规则 | `appendices/policies/cross-border-data-processing-policy.md` | review 1.1，待 Recheck |
| BossResume 状态、Gate、路线和 Auto | `06-project-management-and-evolution.md` | draft 主文档基线 |
| 机器合同 | `schemas/` | 六个现有 Schema 可用 |

`review` 状态的候选规则是唯一候选定义位置，但不具有已批准规则的 Gate 优先级。只有 `approved` 状态可以作为执行冲突时的强制事实源。

## 4. 新增专题覆盖

### 4.1 Prompt 与模型路由

- Prompt Registry、版本、Golden/Negative/Shadow、回滚：PASS。
- Model Provider Adapter、路由、降级、Circuit Breaker：PASS。
- 高风险分类、Review Run/Session 隔离、模型隔离等级和 `BLOCKED_BY_POLICY`：内容完成，候选 Policy 等待批准。

### 4.2 RAG

- 数据源、Chunk、Metadata、Hybrid Retrieval、Rerank、失效、评估：PASS。
- Citation 最小字段、必须引用的输出、Agent Result 集成、Source Verification 和失败行为：内容完成，候选 Contract 等待批准。

### 4.3 第三方风控与数据合规

- Vendor Registry、数据分类、用户授权、最小化、删除/导出、日志脱敏：PASS。
- 跨境识别、地区与子处理商、Policy Gate、替代路径和复审触发：内容完成。
- Policy 1.1 只使用 `APPROVED`、`APPROVED_WITH_REDACTION`、`NEEDS_COMPLIANCE_REVIEW`、`DENIED`、`EXPIRED` 五个状态。
- 决策采用固定优先级和唯一结果矩阵，不再使用 `REDACTION`、`REVIEW` 或“APPROVED 或……”等非确定表达。
- 文档明确工程控制不能替代专业法律审核：PASS。

### 4.4 高可用与容灾

- V0.1 本地恢复、V1 单机可靠、V2 多实例、V3 跨区域：PASS。
- Checkpoint、Reconcile、备份、PITR、Redis 热状态重建、RPO/RTO、恢复演练：PASS。

## 5. M001 最新修订覆盖

`observability-alert-and-retention-policy.md` 1.1 已增加：

- `HEARTBEAT_LEASE_EXPIRY`：覆盖任一单个活动 Task、Run、Session 或 Workflow Owner。
- 高风险/Critical Path 单实例过期为 HIGH，普通执行为 MEDIUM。
- STALE、阻止重复 executionKey、Reconcile 和关闭证据。
- `HEARTBEAT_LEASE_MASS_EXPIRY` 仅作为聚合升级，不替代单实例告警。

内容修复完成，等待独立 Recheck 后确认 M001 是否 CLOSED。

## 6. M004 最新修订覆盖

`cross-border-data-processing-policy.md` 1.1 已增加：

- 五个唯一决策枚举。
- 固定顺序、第一条命中即返回的 Policy Engine 规则。
- 每组数据类别和地区关系对应唯一允许结果。
- 信息不明确、明确禁止和批准过期的确定性结果。
- `matchedRule` 审计字段。
- 禁止输出 `REDACTION`、`REVIEW` 等别名。

内容修复完成，等待独立 Recheck 后确认 M004 是否 CLOSED。

## 7. Policy 审批状态治理

- 四份 Policy/Contract 当前均为 `status: review`。
- README 已明确 `review` 不能用于 Gate 通过，也不能被报告为已批准生效。
- 上一份 `document-reorganization-recheck-v0.2.md` 是历史 Artifact，其“全部 CLOSED”结论已被后续 OpenCode Recheck 证明不再准确，但不覆盖原文件。
- 最新状态通过新的 Review/Remediation Artifact 记录。
- 下一次独立 Recheck 通过后，另行提交 `approved` 状态和 `approved_by`，不在本轮自我批准。

结论：M005 的状态语义冲突已在文档层面消除，等待独立 Reviewer 验证。

## 8. Schema 检查

根 `schemas/` 当前包含：

- task.schema.json
- agent-result.schema.json
- artifact.schema.json
- issue.schema.json
- gate-result.schema.json
- event.schema.json

六个文件为原路径纯移动，内容未改变。

后续待补：

- context-manifest.schema.json
- workstream.schema.json
- session.schema.json
- project-map.schema.json
- trace-link.schema.json
- cost-record.schema.json
- user-decision.schema.json
- prompt-definition.schema.json
- model-routing-policy.schema.json
- citation.schema.json
- release.schema.json
- side-effect-ledger.schema.json

这些是 Contract Implementation Follow-up，不属于本次重组内容丢失。

## 9. 目录与链接

- 六份主文档存在。
- 旧 01～12 目录已删除。
- README 已更新为当前路径。
- Policy/Contract 已注册到 README，并标明 review/approved 生效语义。
- 旧路径只允许出现在迁移历史和 Review Evidence 中。

## 10. 剩余验证 Follow-ups

本次没有执行：

- Mermaid Renderer 渲染级检查。
- Ajv 对 Schema 的正式编译和正负例测试。
- Policy/Contract 对应的运行时代码实现。

这些不替代独立文档 Recheck；在对应控制面模块进入正式 `TEST_GATE` 前必须完成。

## 11. 最终判定

- 内容迁移覆盖：PASS。
- M001/M004 最新内容修订：REMEDIATED_PENDING_RECHECK。
- M002/M003 内容：上一轮 Recheck 已关闭，但 Policy/Contract 状态仍等待统一批准。
- M005 状态冲突：REMEDIATED_PENDING_RECHECK。
- 当前分支：需要一次最新独立 Recheck，尚未声明可合并。
- Auto：继续关闭。
