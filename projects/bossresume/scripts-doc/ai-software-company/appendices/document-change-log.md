# 文档变更记录

```yaml
status: active
version: 0.2-r9
owner: documentation
last_updated: 2026-07-13
```

## 记录规则

重大变更记录：

- 版本和日期。
- 修改原因。
- 受影响模块。
- Schema、Prompt、Session、Cache、State、代码影响。
- Review/Gate 结果。
- 当前许可边界。

## 变更历史

### v0.1 — 2026-07-11

- 建立多 Agent 产品与架构文档集。
- 新增初始 JSON Schema。
- 文档结论：CONDITIONAL_APPROVAL。

### v0.2 — 2026-07-12

- 将文档重组为六份主文档。
- Schema 移至根 `schemas/`。
- 建立 ADR、术语、Change Log 和 Review 附件。
- 补充 Prompt Registry、Model Routing、RAG、合规、可观测性和容灾。
- 不修改 Agent Loop、业务代码、Workflow State 和数据库。

### v0.2-r2 — 2026-07-12

- 根据首次验收补充 Alert/Retention、Citation、高风险独立 Review 和跨境 Policy。
- 保存原始 `CHANGES_REQUESTED`。
- 后续发现部分候选 Policy 被提前描述为已关闭。

### v0.2-r3 — 2026-07-12

- 修复 Heartbeat/Lease 告警缺口。
- 统一跨境决策枚举和结果矩阵。
- README 增加 Policy 状态语义。
- 不把 review 状态 Policy 改为 approved。

### v0.2-r4 — 2026-07-13

- 新增 BossResume A～F 阶段进度台账。
- 映射 M0～M13。
- 记录准入、产物、验收、完成目标和当前状态。
- Codex 验收发现 M001～M003。

### v0.2-r5 — 2026-07-13

- 修复阶段 Gate 映射、双层状态和阶段 E 完整性。
- 阶段 C 映射 `ARCHITECTURE_GATE → UI_GATE → DESIGN_GATE`。
- Integration Evidence 归入 `TEST_GATE`。
- Release Evidence 归入 `ARCHIVE_GATE` 前置条件。
- 状态：RECHECK_REQUIRED。

### v0.2-r6 — 2026-07-13

- 补充 Workflow Phase 闭集。
- 建立 M0 Baseline Checkpoint Contract。
- 统一 README、02、05、06 和 Stage Tracker 的 Gate 语义。
- Codex 完整审核结论：`BLOCKED`。
- 新发现：
  - `STATE-001`：本地运行态与 Git Workflow State 分裂。
  - `DOC-001`：02 文件包含 NUL、截断和未闭合围栏。
  - `ST-002`：01/03 仍使用未注册 Gate 作为当前语义。
  - `DOC-002`：README trailing whitespace。

### v0.2-r7 — 2026-07-13

- 修复 `DOC-001`：
  - 重新生成 UTF-8 `02-architecture-and-system-design.md`。
  - NUL 数应为 0。
  - Markdown/Mermaid 围栏闭合。
  - 补全 Phase、控制面、Reconcile、Artifact、Integration 和恢复规则。
  - 原 v0.2 完整文件保存到 `appendices/history/v0.2/`。
- 修复 `ST-002`：
  - 重写当前 01、02、03 的正式 Gate 语义。
  - Product Lifecycle 只使用 Gate Matrix 注册的八个 Gate。
  - Release Agent 不再声称独立 Gate 权限。
  - Integration Evidence 归入 `TEST_GATE`。
  - Release/Migration/Health/Rollback 归入 `ARCHIVE_GATE` 前置证据。
  - 原 01/02/03 v0.2 文件保存为只读历史。
- 修复 `DOC-002`：
  - README 重新生成，无刻意 Markdown 行尾空格。
- 修复 `STATE-001` 的仓库能力：
  - 新增 `scripts/agent-loop/reconcile-state-sources.mjs`。
  - 新增 `npm run agent:reconcile`。
  - 新增 M0 Preflight Guard。
  - `effectiveApproval=false` 时真实 Product Run 被阻止。
  - 新增 M0 Guard 和 State Reconcile 测试。
  - Workflow JSON/Markdown/Round Context 明确写为 `BLOCKED_BY_SYSTEM / state_source_split`。
  - 新增结构化 SYSTEM Issue。
- 本轮修改控制面代码和状态合同，但不修改业务 PRD、前端、后端、数据库或 Auto Capability。
- 未创建假的 M0 Result。
- PR #30 保持 Draft。
- Review 状态：`RECHECK_REQUIRED`。
- 本地 `.agent-runs/current-*` 和 Worktree 必须在真实开发机执行 `npm run agent:reconcile -- --apply`，远端无法代替该本机操作。

### v0.2-r8 — 2026-07-13

- 修复 `M0-CONTRACT-STATE-001`：
  - M0 Contract 升级为 1.1。
  - 删除易过期的 BossResume 当前状态快照。
  - 合同只保留稳定结构、批准条件和动态事实源引用。
  - `effectiveApproval` 新增 `stateSourcesReconciled` 条件。
- 修复 `GATE-ALLOWLIST-001`：
  - 新增 `scripts/agent-loop/registered-gates.mjs`，以 Gate Matrix 八项正式 Gate 为运行时 allowlist。
  - `NONE` 只允许用于 `INTAKE`。
  - Preflight 在启动 Agent 前拒绝 `TECH_GATE` 等未注册 Gate。
  - Gate Result Validator 拒绝未注册 Gate 和 Workflow/Gate Result 类型不一致。
  - Gate Result Schema 将 `gateType` 收紧为八项枚举。
  - 新增八项正式 Gate、`TECH_GATE` 拒绝、Gate mismatch 和 `NONE` 范围测试。
- `STATE-001` 仍为 OPEN：必须在真实开发机完成写入型 Reconcile。
- 未创建 M0 Result，未进入阶段 B，未启动 Product Agent，Auto 保持 OFF。
- Review 状态：`RECHECK_REQUIRED_AFTER_LOCAL_RECONCILE`。

### v0.2-r9 — 2026-07-13

- 修复 `GATE-DOC-LEGACY-001`：
  - `appendices/adr-register.md` ADR-008 将 OpenAPI、Contract Test 与最终 Integration Commit 验证统一映射为 `TEST_GATE` 的 Integration Evidence。
  - ADR-016 的 Auto 开放条件不再依赖独立 Integration Gate。
  - ADR 使用规则明确 Gate Matrix 八项闭集为当前唯一正式 Gate 权威。
- 修复 `GATE-REVIEW-TERM-001`：
  - `appendices/content-coverage-check.md` 将未注册的 “Implementation Gate” 改为正式 `TEST_GATE`。
- 未修改 Gate Matrix、业务 PRD、业务代码或 Auto Capability。
- `STATE-001` 继续保持 OPEN，必须在真实开发机完成写入型 Reconcile。
- Review 状态：`RECHECK_REQUIRED_AFTER_LOCAL_RECONCILE`。

## 当前状态

```text
DOC-001: CLOSED_PENDING_FULL_REVIEW
DOC-002: CLOSED_PENDING_FULL_REVIEW
ST-001: CLOSED_PENDING_FULL_REVIEW
ST-002: REMEDIATED_PENDING_FULL_REVIEW
ST-003: CLOSED_PENDING_FULL_REVIEW
GATE-DOC-LEGACY-001: REMEDIATED_PENDING_FULL_REVIEW
GATE-REVIEW-TERM-001: REMEDIATED_PENDING_FULL_REVIEW
STATE-001 code/control fix: REMEDIATED_PENDING_LOCAL_APPLY_AND_FULL_REVIEW
M0: NOT_APPROVED
Product Agent: BLOCKED
Business PRD: review_only
Business Code: BLOCKED
Auto: OFF
PR #30: DRAFT
```
