# Architecture Decision Register

```yaml
status: active
version: 0.2-r1
owner: architecture
last_updated: 2026-07-13
```

## 1. ADR 使用规则

每个重要技术决定必须记录：

- 状态：proposed、accepted、superseded、rejected。
- 背景。
- 候选方案。
- 最终决定。
- 原因。
- 已知代价。
- 对 BossResume 的影响。
- 迁移触发条件。
- 替代或回滚方式。
- 复审时间。

ADR 被替代时不删除，使用 `superseded_by` 指向新决定。

当前正式 Gate 只以 `agent-loop-docs/process/gate-matrix.md` 注册的八项 Gate 为准。ADR 中的 Integration、Release、Implementation 等能力名称不得被解释为独立 gateType；未注册 Gate 只能以明确的 Future Target 语境保留，不能用于当前 Workflow 状态推进。

## 2. 当前 ADR

### ADR-001：Node.js + TypeScript 作为核心控制面

- **状态：**accepted。
- **决定：**当前和独立平台核心控制面使用 Node.js + TypeScript。
- **原因：**与 BossResume、CLI、JSON 契约和 Agent 工具链一致。
- **代价：**CPU 密集任务需 Worker/子进程；Python AI 生态通过 Adapter 接入。
- **迁移触发：**Profiling 证明存在明确瓶颈后拆分服务，不重写整个平台。

### ADR-002：BossResume 阶段继续使用自研确定性 Workflow Engine

- **状态：**accepted。
- **决定：**首次闭环前不迁移 LangGraph 或 Temporal。
- **原因：**当前已有状态、Gate、Reverify 和 Auto Guard；迁移会中断真实交付。
- **代价：**Durable Execution、Signal 和多机器能力需要自己补。
- **迁移触发：**多机器、跨天任务、大量 Signal 或恢复成本持续过高时评估 Temporal。

### ADR-003：LangGraph 不作为唯一 Workflow 事实源

- **状态：**accepted。
- **决定：**LangGraph 可用于局部 Agent 推理图，不能替代软件交付全局状态机。
- **原因：**交付流程还包含 Git、Lock、Test、Approval、Release 和 Recovery。

### ADR-004：BullMQ + Redis 负责任务执行与热状态

- **状态：**accepted。
- **决定：**中短期使用 BullMQ 作为 Task Queue，Redis 保存 Lock、Lease、Heartbeat 和队列热状态。
- **原因：**BossResume 已具备依赖，适合 Node Worker 和本地多进程。
- **代价：**Redis 不能作为最终事实源。

### ADR-005：Redis 不是唯一事实源

- **状态：**accepted。
- **决定：**可恢复状态、Task、Artifact、Event 和审计必须持久化到 SQLite/PostgreSQL 或正式文件存储。

### ADR-006：SQLite 为当前 Adapter，PostgreSQL 为目标主存储

- **状态：**accepted。
- **决定：**BossResume v0.1 继续 SQLite/文件，独立平台迁移 PostgreSQL。
- **迁移触发：**多项目、多进程写入、复杂查询、pgvector 和统一审计。
- **约束：**核心代码不得依赖 SQLite 特有行为。

### ADR-007：JSON Schema 2020-12 是 Agent 数据唯一正式运行时合同

- **状态：**accepted。
- **决定：**Task、Agent Result、Issue、Artifact、Gate、Event 等通过 JSON Schema + Ajv 校验。
- **原因：**TypeScript Interface 无法验证运行时和跨语言输出。

### ADR-008：HTTP API 使用 OpenAPI 3.1

- **状态：**accepted。
- **决定：**前后端接口契约使用 OpenAPI 3.1；接口 Schema Diff、Mock、Contract Test 与最终 Integration Commit 的验证结果作为 `TEST_GATE` 的 Integration Evidence。
- **作用：**支持 Schema Diff、Mock、Contract Test 和兼容检查。
- **Gate 边界：**当前不存在独立 `INTEGRATION_GATE`；“Integration Gate”仅作为历史术语保留，不得用于当前 Workflow 状态推进。

### ADR-009：暂不引入 Neo4j

- **状态：**accepted。
- **决定：**Project Map 使用 Nodes + Edges + Version + Evidence。
- **迁移触发：**跨数十项目复杂图查询和图算法成为核心需求。

### ADR-010：向量检索优先 PostgreSQL + pgvector

- **状态：**accepted。
- **决定：**v0.1 先实现 Memory/Retrieval Contract；V1 使用 pgvector。
- **迁移触发：**向量规模和 QPS 超出 PostgreSQL 能力时评估 Qdrant。
- **约束：**向量结果不能覆盖正式事实源。

### ADR-011：Git Worktree 为当前 Sandbox

- **状态：**accepted。
- **决定：**BossResume 使用独立 Worktree、路径白名单和 Tool Policy。
- **代价：**无法完整隔离 CPU、内存、网络和 Secret。

### ADR-012：Container 为目标 Sandbox Adapter

- **状态：**accepted。
- **决定：**多用户、不可信代码和高风险 Agent 强制 Container。
- **迁移触发：**服务端部署、多技术栈环境冲突、需要网络和资源隔离。

### ADR-013：OpenTelemetry 为目标可观测性标准

- **状态：**accepted。
- **决定：**先统一 Event Envelope 和 Trace ID，再接入 OpenTelemetry、Prometheus、Grafana。

### ADR-014：V0.1 采用本地单用户、单项目优先

- **状态：**accepted。
- **决定：**保留 tenantId、userId、projectId、workspaceId 字段，但不实现复杂多租户。
- **迁移触发：**BossResume 和第二项目稳定后进入服务端多用户设计。

### ADR-015：Agent 默认通过 Artifact 和 Event 协作

- **状态：**accepted。
- **决定：**不采用无限自由群聊；跨 Agent 信息必须结构化、版本化和可审计。
- **例外：**复杂方案讨论可创建受控 Meeting Task，并沉淀正式 Artifact。

### ADR-016：Auto 在稳定 Single 前保持关闭

- **状态：**accepted。
- **开放前置条件：**Task Context、Worktree Manifest、Session Registry、Task Lock、Artifact Registry、`TEST_GATE` 的 Integration Evidence 与最终 Integration Commit 验证、Repair 收敛和预算控制进入主链；BossResume 和第二项目完成稳定 Single。
- **Gate 边界：**当前不存在独立 `INTEGRATION_GATE`；Auto 开放条件不得依赖未注册 Gate。

### ADR-017：Prompt 使用 Registry、版本和 Gate 管理

- **状态：**accepted。
- **决定：**System/Role/Phase/Project/Task/Repair Prompt 不散落在脚本和聊天中，统一使用 Prompt Registry。
- **影响：**Prompt 关键版本变化使相关 Session 和 Cache 失效。

### ADR-018：模型通过 Provider Adapter 和 Routing Policy 接入

- **状态：**accepted。
- **决定：**平台不绑定 Codex、OpenCode、Claude 或单一供应商。
- **路由依据：**Task 类型、风险、Context、Tool 能力、合规、成本和 Provider 健康。

### ADR-019：RAG 采用结构化过滤优先的 Hybrid Retrieval

- **状态：**accepted。
- **决定：**先按 Project、Status、Version、Permission 过滤，再进行 Keyword + Vector + Rerank + Source Verification。
- **当前实现：**V0.1 精确路径与 Metadata；V1 pgvector。

### ADR-020：高可用按版本渐进实现

- **状态：**accepted。
- **决定：**V0.1 目标是本地可恢复，不提前建设完整多实例和跨区域系统。
- **路线：**本地可恢复 → 单机服务高可靠 → 多实例高可用 → 跨区域容灾。

## 3. 复审规则

- BossResume 完整交付后统一复审。
- 独立建仓时复审 Adapter、部署、合规和 HA ADR。
- 未达到迁移触发条件，不得仅因“技术更先进”而替换。
- 每次 ADR 变更同步更新六份主文档中的结论、Schema 和 Change Log。
