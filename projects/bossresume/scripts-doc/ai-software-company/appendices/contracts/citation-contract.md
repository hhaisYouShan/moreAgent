# RAG Citation Contract

```yaml
status: review
version: 1.0
owner: data-knowledge
last_updated: 2026-07-12
applies_to: RAG / Review / Gate / Failure Attribution
```

## 1. 目的

本合同是 `04-data-and-knowledge-engineering.md` 中 RAG 与 Source Verification 的可执行补充，规定检索结果、Agent 输出和 Gate Evidence 如何绑定到可验证来源。

Citation 不是装饰性链接，而是用于证明：

- 结论来自哪个 Artifact。
- 使用的是哪个版本和 Hash。
- 来源的具体位置是什么。
- 来源在使用时是否处于有效状态。
- 下游是否能够重新验证。

## 2. Citation 最小合同

```json
{
  "citationId": "citation-...",
  "projectId": "bossresume",
  "artifactId": "artifact-prd-v3",
  "artifactType": "PRD",
  "artifactVersion": 3,
  "artifactStatus": "ACTIVE",
  "path": "docs/prd/bossresume-full-refactor-prd.md",
  "section": "4.2 投递状态机",
  "startLine": 120,
  "endLine": 138,
  "symbol": null,
  "sourceHash": "sha256:...",
  "quotedTextHash": "sha256:...",
  "verificationStatus": "VERIFIED",
  "verificationReason": "ACTIVE artifact and source hash matched",
  "retrievalMethod": "HYBRID",
  "retrievalScore": 0.91,
  "retrievedAt": "..."
}
```

## 3. 字段规则

| 字段 | 要求 |
|---|---|
| citationId | 控制平面生成，项目内唯一 |
| artifactId | 必须指向 Artifact Registry 中存在的对象 |
| artifactVersion | 必须与消费时版本一致 |
| artifactStatus | 默认必须为 ACTIVE；历史分析可显式允许 ARCHIVED/SUPERSEDED |
| path | Git、Artifact Store 或数据源中的稳定路径 |
| section | Markdown/文档的标题路径；无法定位时为 null |
| startLine/endLine | 文本或代码来源的行区间；动态内容可为 null |
| symbol | 类、函数、API、表或字段名称，可选 |
| sourceHash | 整个来源对象 Hash，必填 |
| quotedTextHash | 实际使用片段的 Hash，存在片段时必填 |
| verificationStatus | VERIFIED / STALE / MISSING / HASH_MISMATCH / UNAUTHORIZED / SUPERSEDED / UNSUPPORTED |
| retrievalMethod | EXACT_PATH / KEYWORD / VECTOR / HYBRID / PROJECT_MAP / MANUAL |
| retrievalScore | 仅检索排序使用，不替代验证 |

## 4. 必须携带 Citation 的输出

以下输出中的事实性判断必须带 Citation：

- PRD Review 和 Tech Review 的问题与证据。
- Architecture Gap、影响分析和 Project Map 候选关系。
- Failure Attribution 的根因和 Owner 判断。
- Issue 的 `evidence`。
- Gate Recommendation 中引用的需求、设计和测试结论。
- 基于历史经验或知识库生成的建议。
- 涉及 API、数据库、权限、状态机和迁移的确定性陈述。
- RAG 生成的产品、技术、安全和合规结论。

以下内容可以不带 Citation：

- 明确标识为建议或假设的原创方案。
- 当前 Task Contract 中直接给出的指令。
- 纯格式化、语法和确定性工具输出，但必须引用对应 Tool Evidence。

## 5. Agent Result 集成

Agent Result 应支持：

```json
{
  "citations": ["citation-001", "citation-002"],
  "claims": [
    {
      "claimId": "claim-001",
      "text": "投递状态变更必须保留历史",
      "citationIds": ["citation-001"],
      "claimType": "FACT"
    }
  ]
}
```

每个 `claimType=FACT` 的重要结论至少绑定一个 VERIFIED Citation 或确定性 Tool Evidence。

## 6. RAG 检索结果合同

Context Builder 接收的每个检索结果必须包含：

```json
{
  "chunkId": "chunk-...",
  "content": "...",
  "citation": {},
  "permissions": ["project:bossresume:read"],
  "selectedReason": "Matched active PRD section and API symbol",
  "contextPriority": 80
}
```

没有 Citation 的检索片段不得进入正式 Context Manifest。

## 7. Source Verification

Source Verification 必须依次检查：

1. projectId / tenantId 是否匹配。
2. 当前 Agent 是否有读取权限。
3. Artifact 是否存在。
4. Artifact 状态是否允许消费。
5. Version 是否兼容。
6. path/section/range 是否存在。
7. sourceHash 是否一致。
8. quotedTextHash 是否一致。
9. Base Commit / Project Map Version 是否仍有效。

只有全部通过才标记 `VERIFIED`。

## 8. 验证失败行为

| 状态 | 系统行为 |
|---|---|
| STALE | 不进入 Context；重新检索当前版本 |
| MISSING | 创建 DATA/ARTIFACT Issue；不得猜测正文 |
| HASH_MISMATCH | 阻止消费，进入 ARTIFACT_INTEGRITY_ERROR |
| UNAUTHORIZED | 终止该检索结果并记录安全事件 |
| SUPERSEDED | 默认拒绝；历史分析必须显式声明用途 |
| UNSUPPORTED | 作为未验证信息，不得进入 Gate Evidence |

验证失败不能通过模型“看起来合理”来绕过。

## 9. Gate 规则

以下情况 Gate 必须失败或进入 CHANGES_REQUESTED：

- Blocking/Major Issue 没有 Evidence/Citation。
- 事实性结论引用不存在或未验证来源。
- 引用的是已 SUPERSEDED 的需求，却未声明历史用途。
- Source Hash 与 Registry 不一致。
- Citation 指向无权限项目或租户。
- 关键 Claim 只有向量分数，没有具体来源定位。

## 10. 引用格式

### 人类可读 Markdown

```text
[artifactId@version path#section Lstart-Lend]
```

示例：

```text
[artifact-prd-v3@3 docs/prd/bossresume-full-refactor-prd.md#4.2 L120-L138]
```

### 程序使用

程序必须使用 Citation JSON，不解析 Markdown 显示文本作为唯一事实源。

## 11. 代码和结构化数据定位

- 代码优先使用 `path + symbol + commit + lineRange`。
- OpenAPI 使用 `artifactId + path + endpoint + method`。
- 数据库使用 `schemaArtifactId + table + column/migrationId`。
- Event/Issue/Gate 使用稳定 ID，不依赖显示标题。
- 动态网页或外部来源必须保存抓取时间、URL/Provider、内容 Hash 和授权信息。

## 12. Citation 生命周期

以下变化使 Citation 失效：

- Artifact Version 或 Status 改变。
- Source Hash 改变。
- 文件移动且 Registry 未建立迁移映射。
- 权限改变。
- Base Commit/Project Map Version 改变导致语义过期。
- 用户删除数据或 Retention 清理来源。

失效后应重新生成 Citation，不得原地改写历史 Citation。

## 13. 指标

- Citation Coverage：必须引用的 Claim 中有 Citation 的比例。
- Verified Citation Rate：Citation 中 VERIFIED 的比例。
- Stale Citation Rate。
- Citation Resolution Success Rate。
- Cross-project Citation Violation，目标 0。
- Gate Evidence Citation Failure。

## 14. 分阶段落地

### V0.1

- Artifact/Path/Version/Hash/Section/Line Range。
- Review、Issue、Gate、Failure Attribution 强制 Citation。
- Source Verification 失败时阻断 Context/Gate。

### V1

- 建立 `citation.schema.json`。
- Claim-Citation Trace 表。
- Dashboard 查看引用来源。
- pgvector 检索结果自动生成 Citation。

## 15. 验收标准

- 每个 RAG 片段都可定位到具体来源和版本。
- 关键事实性 Claim 可以反向查到 VERIFIED Citation。
- 旧版本、Hash 不一致和无权限来源无法进入 Gate。
- Citation Coverage 是对正式 Citation 对象的度量，不再只是无合同指标。
