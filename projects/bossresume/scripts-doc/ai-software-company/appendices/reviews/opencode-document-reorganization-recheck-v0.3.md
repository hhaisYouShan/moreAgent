# OpenCode 文档重组 Recheck 报告 v0.3

```yaml
status: completed
version: 0.3
owner: opencode-independent-review
reviewed_branch: docs/reorganize-ai-company-six-modules
reviewed_commit: c4abe7ead6512de8b39c6d4274caff7a9c49a5b0
base_commit: 52c635c95559e707d6697eb88c3068f65e436ca0
result: CHANGES_REQUESTED
reviewed_at: 2026-07-12
immutable_history: true
```

## 1. 验收范围

本次以远程 Git 对象为准，对 PR #28 最新提交进行只读定向 Recheck。未切换分支、未修改文件、未创建 Commit、未 Push、未合并 PR。

检查内容：

- M001 Alert 与运行数据 Retention。
- M002 RAG Citation Contract。
- M003 高风险任务独立 Review。
- M004 跨境与第三方数据处理。
- README、唯一事实源和 Policy 状态。
- 历史 Review Artifact。
- 链接、代码围栏、Mermaid 源码、JSON 和变更边界。

## 2. 自动检查结果

```text
LINK_CHECK_PASS
FENCE_CHECK_PASS
JSON_OK: 6/6
旧路径活动引用：未发现
变更边界：PASS
```

未执行 Mermaid Renderer 和 Ajv 正式 Schema 编译；二者作为后续工程 Follow-up，不阻塞本次文档 Recheck。

## 3. M001 Recheck

### 已通过

- Alert Contract 字段。
- Alert 生命周期、去重、风暴控制、Suppression、升级和关闭证据。
- Duplicate Execution、State Inconsistency、Artifact Integrity、Secret、Budget、Integration Drift、Non-convergent Repair、Critical Test、Release Health、Cross-project Access、Provider Circuit、Backup/Recovery。
- Workflow、Decision、Gate、Release、Task、Issue、Artifact、Event、Agent Log、Tool Audit、Test Report、截图/视频、Build、Token/Cost、Trace、Incident、Prompt/Model、Working Memory 和 Secret 的 Retention。
- 用户删除、Legal Hold 和 Deletion Evidence。

### 未通过

当时仅定义 `HEARTBEAT_LEASE_MASS_EXPIRY`，要求同一窗口多个 Task 同时过期，没有覆盖单个关键 Task、Run、Session 或 Workflow Owner 的 Heartbeat/Lease Expiry。

```text
M001: OPEN
```

## 4. M002 Recheck

Citation 已形成正式、可校验合同，覆盖字段、Claim-Citation 关系、必须引用的输出、Source Verification、失败行为和 Gate 阻断。

```text
M002: CLOSED
```

## 5. M003 Recheck

高风险分类、Task 风险字段、Run/Session 独立性、L1～L4 隔离、`BLOCKED_BY_POLICY`、`BLOCKED_BY_BUDGET` 和 Gate 失败条件完整。

```text
M003: CLOSED
```

## 6. M004 Recheck

### 已通过

- 数据分类、跨境识别、Vendor Registry、请求输入。
- `NEEDS_COMPLIANCE_REVIEW → BLOCKED_BY_COMPLIANCE`。
- DENIED 后的本地模型、脱敏、人工流程和功能暂停。
- 重新评估和法律边界。

### 未通过

决策表使用未定义状态 `REDACTION`、`REVIEW`，并使用“APPROVED 或……”和“依条款……”等不能映射为唯一 Policy 状态的表达。

```text
M004: OPEN
```

## 7. 新增 M005

四份强制 Policy/Contract 顶部均为 `status: review`，但 README 规定只有 `approved` 政策具有冲突优先级，Coverage/Recheck 却提前声明全部 CLOSED 和生效。

这导致：

- Policy 文件：仍在 review。
- README：approved 才正式生效。
- Coverage/Recheck：宣称已经生效并关闭。

```text
M005: OPEN
```

## 8. 问题清单

### M001 — Heartbeat/Lease 告警只覆盖批量过期

- **Severity：**Major
- **Primary Owner：**runtime-platform / engineering-operations
- **阻塞合并：**是
- **要求：**增加单实例 `HEARTBEAT_LEASE_EXPIRY`，明确 Severity、Owner、自动动作和关闭条件。

### M004 — 跨境决策枚举和结果不确定

- **Severity：**Major
- **Primary Owner：**engineering-operations-security-product
- **阻塞合并：**是
- **要求：**只使用正式五个状态；固定判定顺序；同一输入得到唯一结果。

### M005 — Policy 审批状态与关闭结论冲突

- **Severity：**Major
- **Primary Owner：**documentation-review / policy owners
- **阻塞合并：**是
- **要求：**不得在 Policy 仍为 review 时声明已经批准生效；统一 README、Coverage 和 Recheck 语义。

## 9. 最终结论

```text
CHANGES_REQUESTED
```

- Blocking：0。
- Major：3。
- Minor：0。
- M001：OPEN。
- M002：CLOSED。
- M003：CLOSED。
- M004：OPEN。
- Auto：继续关闭。

本报告保存当时验收结论，后续修复不得覆盖本文件。