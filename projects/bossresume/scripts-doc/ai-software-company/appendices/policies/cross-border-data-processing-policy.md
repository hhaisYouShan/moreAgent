# 跨境与第三方数据处理策略

```yaml
status: review
version: 1.1
owner: engineering-operations-security-product
last_updated: 2026-07-12
approval_state: pending_independent_recheck
applies_to: BossResume / Model Provider / Embedding / Logging / Vendor
```

## 1. 目的

本策略是 `05-engineering-and-operations.md` 中第三方风控与 BossResume 数据合规的可执行补充，定义个人数据发送到外部模型、Embedding、日志、对象存储或其他第三方服务前的确定性决策路径。

本策略属于工程和产品控制设计，不能替代部署地区的专业法律意见。涉及不明确法律依据、敏感数据或地区限制时，系统必须阻塞并触发专业审核。

本策略当前处于 `review`。通过独立 Recheck 并转为 `approved` 前，只能用于评审和实现设计，不能被 Policy Gate 当作已批准政策。

## 2. 数据范围

BossResume 可能处理：

- 姓名、电话、邮箱、地址。
- 简历 PDF/DOCX 和结构化内容。
- 工作经历、教育经历、技能和求职意向。
- 投递状态、面试记录、评价和反馈。
- 公司、岗位和第三方招聘网站导入数据。
- AI Prompt、模型输入、模型输出和诊断结果。
- 浏览器操作、日志、测试截图和视频。

## 3. 数据分类

| Class | 定义 | 示例 | 外部处理默认策略 |
|---|---|---|---|
| PUBLIC | 公开且允许处理的数据 | 公开岗位描述、公开公司信息 | 可按 Vendor Policy 处理 |
| INTERNAL | 项目内部非个人数据 | 技术文档、配置说明 | 最小化后处理 |
| PERSONAL | 可识别个人的数据 | 姓名、邮箱、电话、简历 | 需要目的、授权和地区 Policy |
| SENSITIVE_PERSONAL | 对个人影响较高的数据 | 面试评价、求职状态、身份信息 | 默认严格审查或本地处理 |
| SECRET | 凭据和安全信息 | API Key、密码、Token | 永不发送第三方模型或日志 |
| THIRD_PARTY_LICENSED | 来自外部平台且受条款约束 | 招聘网站岗位/公司数据 | 需要来源、授权和用途检查 |

## 4. 跨境处理识别

满足任一条件视为需要执行跨境/跨地区 Policy：

- 数据主体或数据来源地区与处理服务地区不同。
- 主存储地区与 Model/Embedding/Log/Subprocessor 处理地区不同。
- Provider 无法明确保证处理和备份地区。
- 子处理商可能在其他司法辖区访问数据。
- 数据经由全球 CDN、日志或支持系统复制到其他地区。
- 供应商条款发生变化，导致处理位置或子处理链改变。

## 5. Vendor Registry 必填信息

每个第三方供应商必须登记：

```json
{
  "vendorId": "vendor-...",
  "servicePurpose": "resume-analysis",
  "provider": "...",
  "serviceRegions": [],
  "processingRegions": [],
  "storageRegions": [],
  "subprocessors": [],
  "trainingUse": "DISABLED|ENABLED|UNKNOWN",
  "retentionDays": 0,
  "deletionSupport": true,
  "enterprisePrivacyMode": true,
  "securityCertifications": [],
  "contractStatus": "APPROVED",
  "lastReviewedAt": "...",
  "nextReviewAt": "..."
}
```

`trainingUse=UNKNOWN`、处理地区不明确或缺少删除机制时，不得处理 PERSONAL/SENSITIVE_PERSONAL 数据。

## 6. 处理请求决策输入

每次外部处理请求至少包含：

- projectId / tenantId / userId。
- dataClasses。
- dataSubjectRegion。
- sourceRegion。
- currentStorageRegion。
- targetProvider / model / purpose。
- processingRegions / storageRegions / subprocessors。
- userAuthorizationId。
- legalOrPolicyBasis。
- minimizationPlan。
- redactionPlan。
- retentionPlan。
- fallbackPlan。

缺少任一必填输入时，不允许默认放行，结果固定为 `NEEDS_COMPLIANCE_REVIEW`；授权或 Vendor 批准已过期时固定为 `EXPIRED`。

## 7. 决策状态

Policy Engine 只能输出以下五个枚举：

| 状态 | 含义 | 系统行为 |
|---|---|---|
| APPROVED | 满足当前 Policy、授权、目的和地区限制 | 仅发送最小必要数据 |
| APPROVED_WITH_REDACTION | 允许处理，但必须先脱敏或匿名化 | Redaction 验证通过后发送 |
| NEEDS_COMPLIANCE_REVIEW | 法律依据、地区、子处理商或敏感性不明确 | 进入 BLOCKED_BY_COMPLIANCE |
| DENIED | 不允许该 Provider/地区/目的处理 | 禁止外发，执行替代路径 |
| EXPIRED | 供应商、合同、Policy Decision 或用户授权已过期 | 重新评估，不沿用旧批准 |

禁止输出 `REDACTION`、`REVIEW`、`ALLOW` 等未定义别名。

## 8. 确定性判定顺序

Policy Engine 必须按以下顺序执行，第一条命中的规则即为结果：

1. 数据类别包含 `SECRET`：`DENIED`。
2. Vendor、合同、用户授权或既有 Policy Decision 已过期：`EXPIRED`。
3. 缺少必填决策输入、处理地区未知、子处理商未知或法律/政策依据不明确：`NEEDS_COMPLIANCE_REVIEW`。
4. Vendor 明确禁止该目的、来源条款禁止处理、用户已撤回授权或地区 Policy 明确禁止：`DENIED`。
5. 命中第 9 节决策矩阵的明确允许条件：输出矩阵指定的唯一状态。
6. 没有任何允许规则命中：`NEEDS_COMPLIANCE_REVIEW`。

任何规则不得使用“APPROVED 或……”“依条款决定”等需要实现方二次猜测的结果表达。

## 9. 跨境处理决策矩阵

| 数据类别 | 地区关系 | 必须全部满足的条件 | 唯一结果 | 替代路径 |
|---|---|---|---|---|
| PUBLIC | 任意 | Vendor `contractStatus=APPROVED`；来源条款明确允许当前 purpose；处理和存储地区已登记 | APPROVED | 使用其他已批准 Vendor 或本地缓存 |
| INTERNAL | 同地区 | Vendor 已批准；地区已登记；`trainingUse=DISABLED`；purpose 与项目用途一致 | APPROVED | 本地处理 |
| INTERNAL | 跨地区 | Vendor 已批准；全部地区和子处理商明确；企业隐私模式开启；不训练；Minimization/Redaction Plan 已验证 | APPROVED_WITH_REDACTION | 本地模型 |
| PERSONAL | 同地区 | 有效用户授权；purpose 明确；Vendor 已批准；不训练；支持删除；Minimization 和 Redaction Evidence 通过 | APPROVED_WITH_REDACTION | 本地模型或仅发送匿名内容 |
| PERSONAL | 跨地区 | 满足 PERSONAL 同地区全部条件；存在有效专业合规批准 `complianceApprovalId`；目标地区在允许清单 | APPROVED_WITH_REDACTION | 本地处理 |
| SENSITIVE_PERSONAL | 同地区 | 显式授权；Vendor 已批准；独立高风险 Review 通过；专业合规批准有效；Redaction Evidence 通过 | APPROVED_WITH_REDACTION | 本地模型或人工流程 |
| SENSITIVE_PERSONAL | 跨地区 | 显式授权；专业合规批准明确允许该数据类别、purpose、地区、Vendor 和子处理链；独立 Review 通过；Redaction Evidence 通过 | APPROVED_WITH_REDACTION | 本地处理或功能暂停 |
| SECRET | 任意 | 无例外 | DENIED | Secret Provider 本地注入 |
| THIRD_PARTY_LICENSED | 任意 | 来源条款明确允许当前 purpose、存储和再处理；Vendor 已批准；用户触发或授权满足来源要求 | APPROVED | 用户手工录入或不保存 |

### 9.1 未满足矩阵条件时的唯一结果

| 情况 | 结果 |
|---|---|
| 条件信息缺失、来源条款不清楚、跨境合法/政策依据未完成专业审核 | NEEDS_COMPLIANCE_REVIEW |
| 来源条款、用户授权、地区 Policy 或 Vendor 合同明确禁止 | DENIED |
| Vendor、授权、合同或批准超过有效期 | EXPIRED |
| 仅缺少可自动完成的脱敏 Evidence，但其他批准均有效 | NEEDS_COMPLIANCE_REVIEW；完成脱敏验证后重新评估，不直接返回别名状态 |

同一组输入只能得到一个状态。任何人工或 Agent Override 必须形成新的 Policy Decision Artifact，不能直接改写原结果。

## 10. Policy Gate 流程

```text
Classify Data
→ Resolve Subject/Source/Storage/Processing Regions
→ Validate Vendor Registry
→ Validate User Authorization and Purpose
→ Validate Minimization/Redaction/Retention
→ Evaluate Cross-border Rules in Fixed Order
→ APPROVED / APPROVED_WITH_REDACTION / NEEDS_COMPLIANCE_REVIEW / DENIED / EXPIRED
```

### 10.1 APPROVED

- 生成 Policy Decision Artifact。
- 只发送最小字段。
- 记录 Provider、Model、Region、Purpose、Data Class 和 Retention。
- 不记录真实敏感正文到普通日志。

### 10.2 APPROVED_WITH_REDACTION

- 先执行 Redaction。
- 验证电话、邮箱、地址、ID、Secret 等已移除或替换。
- Redaction Evidence 通过后才能调用 Provider。

### 10.3 NEEDS_COMPLIANCE_REVIEW

- Workflow 进入 `BLOCKED_BY_COMPLIANCE`。
- Brain 仅向用户说明业务影响和可选替代路径，不要求用户自行解释法律。
- 由专业法律/合规人员确认可否处理及附加条件。

### 10.4 DENIED

- 不调用目标 Provider。
- 不将数据放入目标地区的 Embedding、Log 或 Storage。
- 按配置选择本地模型、脱敏模式、人工流程或暂停功能。

### 10.5 EXPIRED

- 停止使用旧 Policy Decision、Vendor Approval 或 User Authorization。
- 暂停外部处理或切换已批准安全路径。
- 重新执行 Vendor、授权、地区和合规评估。

## 11. 最小化与脱敏规则

- 简历解析只发送完成解析所需内容，不发送无关项目数据。
- 岗位匹配优先使用结构化技能和经历，不默认发送电话、邮箱、地址。
- 面试评价和求职状态默认视为 SENSITIVE_PERSONAL。
- 测试和日志使用合成数据或脱敏副本。
- Prompt、Trace 和 Error Message 不得包含 Secret。
- Embedding 前执行相同数据分类和地区 Policy，不因“只是向量”而豁免。

## 12. 用户授权与控制

用户应能够：

- 查看启用的第三方服务和处理目的。
- 了解数据可能处理或存储的地区。
- 选择是否允许简历发送外部模型。
- 撤回尚未完成或未来的外部处理授权。
- 请求导出和删除。
- 选择本地/脱敏模式，但系统应说明功能和质量影响。

撤回授权后必须停止新的外部处理，并按策略删除可删除的第三方数据和派生索引。

## 13. 重新评估触发条件

以下变化使原 Policy Decision 失效：

- Provider、Model、Endpoint 或服务地区变化。
- 存储地区或日志地区变化。
- 新增或更换子处理商。
- 供应商训练、保留或删除政策变化。
- 数据类别、处理目的或用户群体变化。
- 用户撤回授权。
- 部署地区、适用政策或项目风险等级变化。
- 发生数据泄漏、安全或合规事件。

失效后禁止继续沿用旧批准，状态转为 `EXPIRED`。

## 14. 审计与证据

每次决策至少记录：

```json
{
  "policyDecisionId": "policy-...",
  "dataClasses": ["PERSONAL"],
  "sourceRegion": "...",
  "processingRegions": ["..."],
  "vendorId": "vendor-...",
  "purpose": "resume-analysis",
  "authorizationId": "consent-...",
  "complianceApprovalId": null,
  "decision": "APPROVED_WITH_REDACTION",
  "matchedRule": "PERSONAL_SAME_REGION",
  "conditions": [],
  "fallback": "LOCAL_MODEL",
  "reviewedBy": "policy-engine|compliance-owner",
  "evidenceIds": [],
  "expiresAt": "..."
}
```

`decision` 必须来自第 7 节定义的五个枚举；`matchedRule` 必须指向确定性判定顺序或矩阵行。

## 15. 数据处理链变化

Vendor Registry 必须监控条款、子处理商和地区变化。变化发生时：

1. 标记受影响 Policy Decision 为 EXPIRED。
2. 暂停新请求或切换安全备用路径。
3. 重新执行 Vendor Risk 和 Cross-border Review。
4. 必要时通知用户并更新授权。
5. 记录迁移、删除和退出 Evidence。

## 16. V0.1 BossResume 最小落地

- 个人数据和敏感个人数据分类。
- 外部模型开关、授权记录和用途说明。
- Vendor Registry 最小字段。
- 外发前 Policy Gate。
- 固定顺序和唯一枚举决策。
- 默认删除电话、邮箱、地址等非必要字段。
- 不满足策略时切换本地/脱敏路径或阻塞。
- Provider、地区或子处理商变化触发复审。

## 17. 验收标准

- 任意外部模型请求都能说明发送了什么、为什么、发往哪里、由谁处理和保留多久。
- PERSONAL/SENSITIVE_PERSONAL 数据跨地区处理有唯一 Policy 状态。
- 决策矩阵只使用 APPROVED、APPROVED_WITH_REDACTION、NEEDS_COMPLIANCE_REVIEW、DENIED、EXPIRED。
- 相同输入按照固定顺序得到相同结果，不依赖实现者自行选择。
- 不满足策略时系统有明确阻塞和本地替代路径。
- Provider 或子处理商变化会使旧决定失效。
- 工程文档明确专业法律审核触发条件，不把用户普通确认当作法律结论。