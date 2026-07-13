# 高风险任务独立 Review 策略

```yaml
status: review
version: 1.0
owner: agent-governance-security
last_updated: 2026-07-12
applies_to: Scheduler / Model Router / Gate Engine
```

## 1. 目的

本策略是 `03-agent-core-mechanisms.md` 中模型路由、Review 和 Gate 的强制补充，用于确保高风险任务不能由实现者自审，也不能因 Provider 不可用而静默降低独立性。

## 2. 高风险任务分类

满足任一条件即标记 `riskLevel=HIGH` 或 `CRITICAL`：

1. 数据库 Migration、数据删除、批量回填或不可逆变更。
2. 身份认证、授权、权限、会话、Token、Secret、加密或安全策略。
3. 个人信息、敏感个人信息、简历、求职状态、面试评价或跨境处理。
4. 生产发布、回滚、Feature Flag、基础设施或外部副作用。
5. 支付、财务、法律、合规或高影响自动决策。
6. 公共 API、数据契约、共享组件、全局状态机或跨模块基础设施。
7. Agent 控制平面、Workflow、Gate、Policy、Lock、Artifact Registry 和 Release 代码。
8. 大范围依赖升级、供应链变更或可执行外部二进制。
9. Failure Attribution 置信度不足但可能触发多模块修改。
10. 项目 Profile 明确标记为高风险的其他任务。

Scheduler 必须在 Task Contract 中记录：

```json
{
  "riskLevel": "HIGH",
  "riskReasons": ["DATABASE_MIGRATION", "PERSONAL_DATA"],
  "independentReviewRequired": true,
  "reviewPolicyId": "high-risk-review@1.0"
}
```

## 3. 独立性最低要求

高风险任务的 Reviewer 必须满足全部条件：

- `reviewRunId != implementationRunId`。
- `reviewSessionId != implementationSessionId`。
- Reviewer 不是执行该 Task 的 Agent 实例。
- Reviewer 使用 Fresh Review Context，不继承实现 Session 的对话历史。
- Reviewer 只读取 Requirement、Approved Design、Code Diff、Test Evidence、Security/Compliance Policy 和必要 Citation。
- Reviewer 不以实现 Agent 的“已完成”“风险很低”等自我结论作为主要证据。
- Review Result 必须输出独立 Evidence、Issue 和结论。

## 4. 模型与 Provider 隔离等级

按以下优先级选择：

| 等级 | 隔离方式 | 适用 |
|---|---|---|
| L1 | 不同 Provider + 不同 Model + Fresh Session | CRITICAL 首选 |
| L2 | 同 Provider、不同 Model + Fresh Session | HIGH 默认可接受 |
| L3 | 同 Model、不同 Agent Contract + Fresh Session + Independent Context | 仅在策略允许且增加确定性检查时 |
| L4 | 同 Session 或同 Run 自审 | 永远禁止 |

项目可以配置最低隔离等级：

```json
{
  "criticalMinimumIsolation": "L1",
  "highMinimumIsolation": "L2",
  "fallbackIsolation": "L3"
}
```

## 5. 无法满足独立性时的行为

- 不允许静默使用实现 Session 自审。
- 不允许把高风险任务降级成普通 Review。
- 如果最低隔离等级不可满足，进入 `BLOCKED_BY_POLICY`。
- 若存在兼容 Reviewer，但成本超限，进入 `BLOCKED_BY_BUDGET`，由用户决定预算或范围。
- 若涉及生产、个人数据或不可逆副作用，不允许通过普通人工口头确认绕过正式 Review Artifact。

## 6. 强制 Review 类型

高风险任务至少执行：

1. **Independent Code/Design Review**：检查需求、设计、范围和实现。
2. **Deterministic Checks**：Schema、Build、Typecheck、Test、Migration、Secret、Dependency 等。
3. **Domain Review**：按风险增加 Security、Data、Compliance、Release 或 Database Review。
4. **Gate Evaluation**：Gate Engine 独立计算，不采信单一 Reviewer 的 PASS 作为最终结果。

### 风险到 Review 的映射

| 风险原因 | 必须 Reviewer / Check |
|---|---|
| DATABASE_MIGRATION | Backend Architect + Migration Dry Run + Rollback Check |
| AUTHORIZATION / SECRET | Security Review + Permission/Secret Scan |
| PERSONAL_DATA / CROSS_BORDER | Data/Compliance Review + Policy Gate |
| PRODUCTION_RELEASE | Release Review + Health/Rollback Evidence |
| CONTROL_PLANE | Architecture + Control-plane Regression |
| PUBLIC_CONTRACT | Frontend/Backend Cross Review + Contract Diff |
| SUPPLY_CHAIN | Security + License/Vulnerability/Install Script Check |

## 7. Review Context

Reviewer Context Manifest 必须明确：

- requirementIds。
- approvedDesignArtifactIds。
- codeDiff/baseCommit/headCommit。
- requiredPolicies。
- deterministicCheckEvidenceIds。
- relatedIssueIds。
- citations。
- forbiddenInputs，例如实现 Session 的完整自由推理。

Reviewer 可以读取实现 Agent 的结构化 Agent Result，但不得只基于自评结论判断通过。

## 8. Gate 规则

以下任一情况导致 Gate 不通过：

- 高风险 Task 没有独立 Review。
- Reviewer Run/Session 与实现 Run/Session 相同。
- 未达到项目配置的最低模型隔离等级。
- 必须的领域 Reviewer 缺失。
- 确定性检查失败但 Reviewer 给出 APPROVED。
- Review Evidence/Citation 不完整。
- Reviewer 存在权限冲突或越权读取。

Gate 状态建议：

- 条件未满足：`BLOCKED_BY_POLICY`。
- Review 发现问题：`CHANGES_REQUESTED`。
- Review 系统故障：`BLOCKED_BY_SYSTEM`。
- 全部通过：进入下一 Gate，但不代表用户最终验收。

## 9. 人工 Review

人工 Reviewer 也必须：

- 独立于实现责任人。
- 有明确身份和权限。
- 使用正式 Review Checklist。
- 输出 Review Artifact 和 Evidence。
- 不通过聊天中的“看起来没问题”替代 Gate。

## 10. V0.1 BossResume 最小落地

BossResume 首次闭环至少对以下内容启用强制独立 Review：

- Applications/Interview 数据库 Migration。
- 简历、联系方式、投递和面试等个人数据处理。
- AI Prompt Registry 与外部模型请求。
- 身份和权限相关改动。
- Agent Loop、Workflow、Gate、Integration 和 Auto Capability。
- Release/Migration/Rollback。

V0.1 可以使用同 Provider 不同 Model；若只有同一 Model，可使用 L3，但必须 Fresh Session、独立 Context、独立 Agent Contract，并增加确定性测试。CRITICAL 任务若项目策略要求 L1 而无法满足，必须阻塞。

## 11. 审计字段

Review Artifact 至少记录：

```json
{
  "implementationRunId": "run-impl-...",
  "reviewRunId": "run-review-...",
  "implementationSessionId": "session-impl-...",
  "reviewSessionId": "session-review-...",
  "implementationModel": "...",
  "reviewModel": "...",
  "providerIsolationLevel": "L2",
  "riskLevel": "HIGH",
  "riskReasons": [],
  "reviewEvidenceIds": [],
  "policyResult": "PASS"
}
```

## 12. 验收标准

- 高风险 Task 可被程序确定性分类。
- 实现 Run 和 Review Run/Session 必须分离。
- 无法满足隔离要求时明确阻塞，不静默自审。
- 高风险 Review 能映射到 Security、Data、Migration、Release 等领域检查。
- Gate 可以根据结构化字段验证独立性。
