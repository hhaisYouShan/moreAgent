# AI Software Company OS 文档重组 Gate（v0.2）

```yaml
status: approved_with_follow_ups
version: 0.2
owner: documentation-review
review_date: 2026-07-12
scope: scripts/doc/ai-software-company
```

## 1. Gate 结论

**APPROVED_FOR_MERGE_WITH_FOLLOW_UPS**

本次重组已经按既定 12 步完成：

1. 创建六份新主文档框架。
2. 迁移产品和架构。
3. 迁移 Agent 与流程。
4. 迁移数据契约和记忆。
5. 迁移治理和可观测性。
6. 迁移 BossResume Profile 和路线。
7. 移动 Schema。
8. 建立 Appendices。
9. 执行内容覆盖检查。
10. 删除旧目录。
11. 更新 README。
12. 完成本 Gate。

## 2. 变更范围检查

Git Diff 只涉及：

```text
scripts/doc/ai-software-company/**
```

没有修改：

- Agent Loop 运行代码。
- BossResume 前后端业务代码。
- Workflow State。
- BossResume 业务 PRD。
- 数据库 Schema/Migration。
- package.json 或依赖。
- Auto Capability。

结果：**PASS**。

## 3. 结构检查

### 六份主文档

- [x] `01-business-and-product.md`
- [x] `02-architecture-and-system-design.md`
- [x] `03-agent-core-mechanisms.md`
- [x] `04-data-and-knowledge-engineering.md`
- [x] `05-engineering-and-operations.md`
- [x] `06-project-management-and-evolution.md`

### 机器契约

- [x] `schemas/task.schema.json`
- [x] `schemas/agent-result.schema.json`
- [x] `schemas/artifact.schema.json`
- [x] `schemas/issue.schema.json`
- [x] `schemas/gate-result.schema.json`
- [x] `schemas/event.schema.json`

Git 比较识别六个 Schema 为纯 `renamed`，内容变化为 0。

### 附件

- [x] ADR Register。
- [x] Terminology。
- [x] Document Change Log。
- [x] Content Coverage Check。
- [x] v0.1 历史 Review。
- [x] v0.2 重组 Gate。

结果：**PASS**。

## 4. 旧目录清理检查

以下旧目录中的文件已全部删除：

```text
01-product/
02-architecture/
03-workflow/
04-state-machine/
05-agents/
06-contracts/
07-memory/
08-governance/
09-observability/
10-bossresume-profile/
11-roadmap/
12-review/
```

旧内容已在 `appendices/content-coverage-check.md` 中逐文件映射到新位置。

结果：**PASS**。

## 5. 内容覆盖检查

以下内容保留并有唯一事实源：

- 产品愿景、用户、场景、人机边界、快稳好。
- 当前架构、目标四平面架构、技术选型和 Adapter。
- Workflow、Task、Issue、Session、Integration、Release 状态机。
- Agent 角色、权限、Task DAG、Session、Lock、通信和 Repair。
- Task、Agent Result、Artifact、Issue、Gate、Event 数据契约。
- Working、Long-term、Shared Memory。
- 成本、安全、权限、兜底、可观测性和 Benchmark。
- BossResume Profile、Gate、实施路线和独立建仓计划。

新增内容：

- Prompt Registry、Prompt Gate 和版本失效。
- 模型路由、Provider Adapter 和 Circuit Breaker。
- RAG 数据源、Chunk、Hybrid Retrieval、Rerank 和评估。
- 第三方 Vendor Risk 和模型供应商数据策略。
- BossResume 数据分类、授权、导出、删除和外部平台风险。
- 高可用阶段、RPO/RTO、备份和灾难恢复。

结果：**PASS_WITH_FOLLOW_UPS**。

## 6. 唯一事实源检查

| 内容 | 唯一位置 | 结果 |
|---|---|---|
| 产品定义 | 01 | PASS |
| 架构、状态和技术选型 | 02 | PASS |
| Agent、Prompt、模型和执行机制 | 03 | PASS |
| 契约、Artifact、Project Map、Memory、RAG | 04 | PASS |
| 工程质量、安全、合规、成本、Observability、HA | 05 | PASS |
| BossResume 状态、路线、版本和 Auto | 06 | PASS |
| 机器合同 | schemas | PASS |
| 技术决策 | ADR Register | PASS |
| 历史评审 | appendices/reviews | PASS |

结果：**PASS**。

## 7. README 检查

README 已更新为：

- 六模块导航。
- Schema 和 Appendices 说明。
- 唯一事实源。
- 推荐阅读顺序。
- 文档拆分规则。
- 状态和变更治理。

不存在指向已删除旧目录的导航链接。

结果：**PASS**。

## 8. Follow-ups

本次重组不阻塞合并，但后续 Contract 实现前必须补齐：

- context-manifest.schema.json。
- workstream.schema.json。
- session.schema.json。
- project-map.schema.json。
- trace-link.schema.json。
- cost-record.schema.json。
- user-decision.schema.json。
- prompt-definition.schema.json。
- model-routing-policy.schema.json。
- release.schema.json。
- side-effect-ledger.schema.json。

还需在后续工程任务中执行：

- Ajv 编译和 Schema 正负例测试。
- Markdown 内部链接检查。
- Mermaid Renderer 检查。
- 术语和 Requirement ID 的 Lint。
- 合规章节的实际地区/供应商专业审查。

这些是文档运行时质量与后续实现任务，不是本次结构重组阻断项。

## 9. 最终判断

本次重组达成目标：

```text
原 12 类分散目录
→ 6 份模块化主文档
+ schemas 机器合同
+ appendices 决策与历史证据
```

结构更适合人类阅读、Agent 定向加载、唯一事实源管理和未来独立建仓。

**Gate Result：APPROVED_FOR_MERGE_WITH_FOLLOW_UPS**
