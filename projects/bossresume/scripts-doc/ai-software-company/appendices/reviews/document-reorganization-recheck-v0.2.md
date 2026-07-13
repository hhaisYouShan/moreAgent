# 文档重组问题修复复核报告

```yaml
status: completed
version: 0.2-r2
owner: documentation-review
reviewed_branch: docs/reorganize-ai-company-six-modules
source_review: opencode-document-reorganization-acceptance-v0.2.md
result: APPROVED_WITH_ENGINEERING_FOLLOW_UPS
reviewed_at: 2026-07-12
```

## 1. 复核范围

本次仅复核 OpenCode 在 PR #28 中提出的 M001～M004 文档问题，不把对应运行时代码尚未实现判为文档缺陷。

修复原则：

- 六份主文档继续保持模块化概览。
- 需要独立版本、程序校验和跨模块执行的规则进入强制 Policy/Contract 附件。
- 强制附件必须在 README 中登记所属主模块和唯一事实源。
- 原 OpenCode 报告保持不可变，本报告记录关闭结果。

## 2. M001 修复：Alert 与运行数据 Retention

### 修复文件

```text
appendices/policies/observability-alert-and-retention-policy.md
appendices/content-coverage-check.md
README.md
```

### 已补内容

- Alert Contract：type、severity、trigger、window、deduplicationKey、evidence、Owner、autoAction、userDecisionRequired、resolution。
- CRITICAL/HIGH Alert：重复活动执行、Workflow/Gate 不一致、Artifact Integrity、Heartbeat/Lease、Secret、Budget、Integration Drift、Non-convergent Repair、Critical Test、Release Health、Cross-project Data、Provider Circuit、Backup Recovery。
- Alert State、升级、去重、抑制和关闭条件。
- Workflow/Decision/Gate/Release、Task/Issue/Artifact、Event、Agent Log、Tool Audit、Test Report、视频截图、Build、Token/Cost、Metrics、Trace、Alert/Incident、Prompt/Model 的 Retention。
- 用户删除、Legal Hold、脱敏和删除证据。

### 结论

```text
M001: CLOSED
```

初版 Coverage Check 对 Alert/Retention 的错误 PASS 已被 0.2-r2 覆盖检查纠正。

## 3. M002 修复：RAG Citation Contract

### 修复文件

```text
appendices/contracts/citation-contract.md
README.md
```

### 已补内容

- Citation 最小合同：artifactId、type、version、status、path、section、line range、symbol、sourceHash、quotedTextHash、verificationStatus、retrievalMethod 和 score。
- 必须携带 Citation 的 Review、Issue、Gate、Failure Attribution 和 RAG 事实性输出。
- Agent Result 的 Claim-Citation 关联。
- RAG Chunk 的 Citation 嵌入。
- Source Verification 顺序。
- STALE、MISSING、HASH_MISMATCH、UNAUTHORIZED、SUPERSEDED 和 UNSUPPORTED 的阻断行为。
- Gate 失败条件、代码/OpenAPI/Database 定位方式和 Citation 生命周期。
- 后续 `citation.schema.json` 计划。

### 结论

```text
M002: CLOSED
```

Citation Coverage 现在对应正式 Citation 对象，不再只是无合同指标。

## 4. M003 修复：高风险任务独立 Review

### 修复文件

```text
appendices/policies/high-risk-independent-review-policy.md
README.md
```

### 已补内容

- 高风险分类：Migration、Auth/Permission/Secret、个人数据、外部副作用、发布、合规、公共 Contract、控制平面、依赖供应链和低置信度归因。
- Task Contract 风险字段。
- 强制 `reviewRunId != implementationRunId`、`reviewSessionId != implementationSessionId`。
- Fresh Review Context、独立 Agent 实例和证据边界。
- L1～L4 Provider/Model/Session 隔离等级。
- 无法满足最低隔离时 `BLOCKED_BY_POLICY`，成本不足时 `BLOCKED_BY_BUDGET`。
- 风险到 Security/Data/Migration/Release/Contract Review 的映射。
- Gate 失败规则和审计字段。

### 结论

```text
M003: CLOSED
```

高风险 Review 已由建议性表述升级为可由 Scheduler、Model Router 和 Gate 验证的强制 Policy。

## 5. M004 修复：跨境与第三方数据处理

### 修复文件

```text
appendices/policies/cross-border-data-processing-policy.md
README.md
```

### 已补内容

- BossResume 数据分类和跨境识别条件。
- Vendor Registry 的地区、子处理商、训练、保留和删除字段。
- 每次处理请求的地区、目的、授权、最小化、脱敏和替代路径输入。
- APPROVED、APPROVED_WITH_REDACTION、NEEDS_COMPLIANCE_REVIEW、DENIED、EXPIRED 状态。
- 普通个人信息、敏感个人信息、Secret 和第三方授权数据的决策表。
- `BLOCKED_BY_COMPLIANCE`、本地模型、脱敏、人工流程和功能暂停路径。
- Provider、地区、子处理商、用途和用户授权变化后的强制复审。
- Policy Decision Artifact 和审计字段。
- 专业法律审核触发条件。

### 结论

```text
M004: CLOSED
```

跨境处理现在有明确识别、Policy Gate、阻塞、替代和复审路径。

## 6. README 与事实源复核

README 已明确：

- 六份主文档负责总体模块语义。
- 强制 Policy/Contract 具有独立版本，是所属主模块的一部分。
- 四份新增政策/合同均已登记路径、所属模块和作用。
- 事实源表分别指定高风险 Review、Citation、Alert/Retention 和跨境处理的唯一位置。
- 待补 Schema 增加 Citation。

结论：PASS。

## 7. 内容覆盖复核

`appendices/content-coverage-check.md` 已升级为 `0.2-r2`：

- 明确纠正初版 Alert/Retention 错误结论。
- 标记 M001～M004 文档层面 CLOSED。
- 区分主文档概览和强制执行政策。
- 保留 Ajv、Mermaid Renderer 和运行时代码实现 Follow-up。

结论：PASS。

## 8. 当前剩余 Follow-ups

以下工作不阻塞本次文档重组合并，但在对应模块进入 Implementation Gate 前必须完成：

- 创建并 Ajv 编译 `citation.schema.json`、Prompt、Model Routing、Context、Session 等待补 Schema。
- 使用 Mermaid Renderer 做渲染级验证。
- 为 Alert、Retention、High-risk Review、Citation 和 Cross-border Policy 建立程序化 Gate 和测试。
- 部署前根据实际服务地区、供应商和数据流进行专业法律审核。

## 9. 最终结论

```text
APPROVED_WITH_ENGINEERING_FOLLOW_UPS
```

- Blocking：0。
- Open Major：0。
- M001～M004：全部 CLOSED。
- 文档重组可以进入再次独立验收和合并评估。
- Auto 继续保持关闭。