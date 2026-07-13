# 文档重组 Recheck 修复说明 v0.3

```yaml
status: review
version: 0.3
owner: documentation-review
source_review: opencode-document-reorganization-recheck-v0.3.md
branch: docs/reorganize-ai-company-six-modules
result: REMEDIATED_PENDING_INDEPENDENT_RECHECK
updated_at: 2026-07-12
```

## 1. 修复范围

本次针对 OpenCode 第二轮 Recheck 的三个 Major：

- M001：Heartbeat/Lease 告警只覆盖批量过期。
- M004：跨境决策枚举和结果不确定。
- M005：Policy 审批状态与 Coverage/Recheck 结论冲突。

M002 Citation Contract 和 M003 高风险独立 Review 的正文未改动，保留上一轮已通过内容。

## 2. M001 修复

修改：

```text
appendices/policies/observability-alert-and-retention-policy.md
```

版本由 1.0 升级为 1.1，新增：

- `HEARTBEAT_LEASE_EXPIRY` 基础告警，覆盖单个活动 Task、Run、Session 或 Workflow Owner。
- 高风险/Critical Path 执行为 HIGH，普通执行为 MEDIUM。
- 触发后标记 STALE、阻止同 executionKey 重复启动、执行 Reconcile。
- 关闭前必须证明旧执行不再活动，Lease 已释放或安全接管完成。
- `HEARTBEAT_LEASE_MASS_EXPIRY` 只作为聚合升级，不替代单实例告警。
- 批量告警引用其聚合的单实例 Alert ID。

当前状态：

```text
CONTENT_REMEDIATED
POLICY_STATUS=review
APPROVAL=pending_independent_recheck
```

## 3. M004 修复

修改：

```text
appendices/policies/cross-border-data-processing-policy.md
```

版本由 1.0 升级为 1.1，完成：

- Policy Engine 只允许五个状态：
  - APPROVED
  - APPROVED_WITH_REDACTION
  - NEEDS_COMPLIANCE_REVIEW
  - DENIED
  - EXPIRED
- 明确禁止 `REDACTION`、`REVIEW`、`ALLOW` 等别名。
- 增加固定判定顺序，第一条命中即返回。
- 缺输入、地区未知、法律/政策依据不明固定为 NEEDS_COMPLIANCE_REVIEW。
- 明确禁止固定为 DENIED。
- 授权、Vendor、合同或批准过期固定为 EXPIRED。
- 重写决策矩阵，每一行只有一个结果。
- 增加未满足矩阵条件时的唯一结果表。
- 增加 `matchedRule` 审计字段。

当前状态：

```text
CONTENT_REMEDIATED
POLICY_STATUS=review
APPROVAL=pending_independent_recheck
```

## 4. M005 修复

修改：

```text
README.md
appendices/content-coverage-check.md
```

并新增：

```text
appendices/reviews/opencode-document-reorganization-recheck-v0.3.md
```

### 状态语义统一

README 现在明确：

| status | 是否可用于 Gate 通过 |
|---|---:|
| draft | 否 |
| review | 否，只是候选规则 |
| approved | 是，且必须有 approved_by |
| superseded | 否，仅历史审计 |

### Coverage 修正

`content-coverage-check.md` 升级到 0.2-r3：

- 不再声明四项全部 CLOSED。
- 明确 M001/M004 为 `REMEDIATED_PENDING_RECHECK`。
- 明确 M002/M003 正文已通过，但 Policy/Contract 仍为 review，等待统一批准。
- 明确 M005 通过状态语义对齐完成修复，等待独立 Reviewer 验证。

### 历史完整性

- 原 `document-reorganization-recheck-v0.2.md` 保持原始内容，不覆盖、不改写历史结论。
- OpenCode 第二轮 `CHANGES_REQUESTED` 单独保存为 `opencode-document-reorganization-recheck-v0.3.md`。
- 本文件只记录修复，不自行把 Policy 改为 approved。
- 当前有效状态由 README、Coverage 0.2-r3、OpenCode v0.3 和本修复说明表达；旧报告仅反映当时判断。

## 5. 为什么本轮不直接批准 Policy

批准必须满足：

1. 最新独立 Recheck 明确通过。
2. Policy 文件从 review 改为 approved。
3. 填写 `approved_by`，引用独立 Review/Gate Artifact。
4. 新建最终批准 Artifact，不覆盖历史 CHANGES_REQUESTED 报告。

本轮属于修复方提交，不能同时充当独立批准者。

## 6. 当前准确状态

```text
M001: REMEDIATED_PENDING_RECHECK
M002: CONTENT_CLOSED_PENDING_POLICY_APPROVAL
M003: CONTENT_CLOSED_PENDING_POLICY_APPROVAL
M004: REMEDIATED_PENDING_RECHECK
M005: REMEDIATED_PENDING_RECHECK
Blocking: 0
Auto: OFF
```

## 7. 下一次 Recheck 准入点

独立 Reviewer 只需重点检查：

- 单实例 Heartbeat/Lease 告警是否完整且不被 Mass Expiry 替代。
- 跨境 Policy 是否只使用五个枚举、固定顺序和唯一结果。
- README、Coverage、Policy 顶部状态是否一致。
- 历史 Review Artifact 是否保持不可变。
- 变更仍只位于 `scripts/doc/ai-software-company/**`。

## 8. 当前结论

```text
REMEDIATED_PENDING_INDEPENDENT_RECHECK
```

当前不宣称 PR #28 已通过或可合并；等待最新独立 Recheck。