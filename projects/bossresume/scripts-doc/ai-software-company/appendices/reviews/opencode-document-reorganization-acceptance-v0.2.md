# OpenCode 文档重组验收报告

```yaml
status: completed
version: 0.2
reviewer: OpenCode
reviewed_commit: fdc8edb32a7ce671f9c38f511003c904e9c553b8
base_commit: 52c635c95559e707d6697eb88c3068f65e436ca0
result: CHANGES_REQUESTED
recorded_at: 2026-07-12
```

## 1. 验收范围

- 仓库：`hhaisYouShan/bossResume`
- PR：#28
- 基线：`master`
- 分支：`docs/reorganize-ai-company-six-modules`
- 目录：`scripts/doc/ai-software-company/`
- 方式：只读 Git 对象比较；未修改文件、未提交、未合并。

本次验收只检查文档重组，不把 Session Registry、RAG、Prompt Registry、容灾或 Auto 尚未实现判为缺陷。

## 2. 执行检查

OpenCode 执行了：

- Git 分支、Merge Base、Diff 和变更边界检查。
- 文件与目录枚举。
- Markdown 标题、链接、代码围栏和占位符检查。
- Mermaid 源码结构人工检查。
- JSON 解析与 JSON Schema 结构检查。
- 新旧 Schema SHA-256 比对。
- 新旧文档专题语义比对。

结果：

```text
LINK_CHECK_PASS
SCHEMA_CHECK_PASS
6 个 Schema 新旧 SHA-256 一致
未发现未闭合代码块
未发现 TODO/TBD/FIXME/placeholder
```

未执行 Mermaid Renderer 和 Ajv 编译器。

## 3. 通过项

- 六份核心文档、`schemas/` 和 `appendices/` 均存在。
- 旧 01～12 目录已删除，README 无失效导航。
- 产品、架构、流程、状态机、Agent、数据契约、记忆、BossResume Profile 和路线主体语义保留。
- 唯一事实源边界清楚。
- 六个 Schema 可解析、使用 JSON Schema 2020-12，且移动过程内容未改变。
- Mermaid、链接、格式和变更边界源码级检查通过。
- 文档可以支持 BossResume PRD Review → 技术设计 → 最小控制面 → Task DAG → 开发 → Integration → Testing → 验收。

## 4. Major 问题

### M001：旧版 Alert 与运行数据 Retention 规则丢失

- **Severity：**Major
- **问题：**新可观测性章节缺少旧文档中的高优先级 Alert 触发、Owner、自动动作、用户参与和运行数据保留矩阵；覆盖检查却宣称 PASS。
- **影响：**无法推导 Alert Backlog、告警验收标准和运行证据保留策略。
- **建议：**恢复 Alert 与 Observability Data Retention，并修正覆盖检查。
- **Owner：**engineering-operations / documentation-review

### M002：RAG Citation 只有指标，没有正式输出合同

- **Severity：**Major
- **问题：**已有 Source Verification 和 Citation Coverage，但没有 artifact/version/path/range/hash/verificationStatus 等正式 Citation 对象。
- **影响：**Review、Issue、Gate 和 Agent 输出无法绑定可验证来源。
- **建议：**建立最小 Citation Contract，并规定验证失败时不得进入 Context/Gate。
- **Owner：**data-knowledge

### M003：高风险任务独立 Review 未形成强制路由规则

- **Severity：**Major
- **问题：**文档使用“尽量不同模型”等建议性表达，未定义高风险类别、Run/Session 隔离和无法满足独立性时的阻塞行为。
- **影响：**Scheduler、Model Router 和 Gate 无法确定性执行独立 Review。
- **建议：**建立 High-Risk Review Policy，明确 Reviewer 独立性和 `BLOCKED_BY_POLICY`。
- **Owner：**agent-governance / security

### M004：跨境和第三方数据处理缺少明确决策路径

- **Severity：**Major
- **问题：**已有供应商地区、子处理商和敏感内容 Policy Check，但缺少跨境识别、审批状态、地区策略、替代路径和复审触发。
- **影响：**无法判断简历、联系方式和面试数据何时允许发送外部模型。
- **建议：**增加跨境处理决策表和 APPROVED/REVIEW/DENIED 路径。
- **Owner：**engineering-operations / security / product

## 5. Blocking 与 Minor

- Blocking：无。
- 独立 Minor：无。

## 6. 最终结论

```text
CHANGES_REQUESTED
```

理由：目录、Schema、变更边界和主干重组整体合格，但 4 项 Major 必须在合并前完成文档修复。修复不要求实现目标架构，Auto 继续关闭。

## 7. 后续处理

本报告为不可覆盖的原始 Review Artifact。问题关闭情况记录在独立 Recheck 文档中，不修改本报告原结论。
