# bossResume PRD Review Standard

本文档定义 bossResume 终端全自动 Agent Loop 的 PRD Review 标准。Product Agent、Frontend Agent、Backend Agent、Test Agent、UI Agent 和 PRD_GATE 都必须按本标准判断 PRD 是否可以进入下一阶段。

## 1. 适用范围

本标准适用于：

- `PRODUCT_REVIEW`：Product Agent 对 PRD 进行初审、问题汇总和修订建议。
- `PRD_REVIEW`：Frontend/Backend/Test/UI 四方 PRD Review。
- `PRD_GATE`：Brain Orchestrator 汇总 Review 输出后进行 Gate 判定。
- `CHANGES_REQUESTED` 后的 PRD 修复和 `RECHECK_REQUIRED` 复查。

## 2. Review 目标

PRD Review 的目标不是“看起来完整”，而是确认 PRD 是否已经达到以下交付标准：产品能验收、前端能拆方案、后端能拆方案、测试能写用例、UI 能设计。

## 3. 必读输入

所有参与 PRD Review 的 Agent 必须先读取：

- `AGENTS.md`
- `docs/README.md`
- `agent-loop-docs/README.md`
- `agent-loop-docs/process/workflow-state.md`
- `agent-loop-docs/process/agent-registry.md`
- `agent-loop-docs/process/gate-matrix.md`
- `agent-loop-docs/process/brain-loop-protocol.md`
- `agent-loop-docs/process/prd-review-standard.md`
- 当前 `workflow-state.md` 中记录的 PRD 路径

如果 PRD 声明为已有项目增量改造，还必须优先核对现有系统约束，包括已有路由、页面、接口、数据库 schema、测试和历史文档；不能把已有能力当成从 0 到 1 重新设计。

## 4. 通用检查清单

| 维度 | 必须确认的问题 | 缺失时默认 owner_agent |
|---|---|---|
| 项目类型 | PRD 是否明确是 `existing_refactor` 还是 `new_project`；已有项目是否说明复用、修改、新增和删除范围 | `product_agent` |
| 需求范围 | 每个功能是否标记新增/修改/删除；是否说明本期范围、非本期范围、依赖和优先级 | `product_agent` |
| 用户流程 | 主流程、分支流程、失败流程、重试流程、取消流程是否明确 | `product_agent` |
| 页面行为 | 页面入口、列表、详情、表单、弹窗/抽屉、筛选、排序、分页、空态、加载态、错误态、权限态是否明确 | `frontend_agent` / `ui_agent` |
| 实体关系 | 核心实体、字段、唯一标识、关系、数据来源和生命周期是否明确 | `backend_agent` |
| 状态机 | 所有业务状态、触发动作、允许/禁止流转、终态和回滚规则是否明确 | `product_agent` / `backend_agent` / `test_agent` |
| 接口契约 | API 路径、方法、请求参数、响应结构、错误码、权限、幂等键、分页和排序规则是否明确 | `backend_agent` / `frontend_agent` |
| 数据库 | 新增/修改表、字段、索引、唯一约束、迁移策略、兼容策略和回滚策略是否明确 | `backend_agent` |
| AI 能力 | 输入、输出 JSON、提示词版本、模型/供应商、重试、降级、人工修正和可追溯字段是否明确 | `product_agent` / `backend_agent` / `test_agent` |
| 验收标准 | 是否可以直接转成测试用例；是否包含 Given/When/Then 或等价的可验证条件 | `test_agent` |
| 非功能约束 | 性能、权限、安全、数据隔离、日志、监控、审计、导入导出大小限制是否明确 | `backend_agent` / `test_agent` |
| 兼容影响 | 是否说明对现有路由、接口、数据、权限、旧页面和历史数据的影响 | `product_agent` / `frontend_agent` / `backend_agent` |

## 5. 角色专项标准

Product Agent 必须判断业务目标、用户价值、范围、用户确认问题、direct_edit 授权和多方 Review 处理结论。

Frontend Agent 必须判断页面结构、路由入口、组件拆分、数据流、列表/详情/表单/筛选/分页/批量操作、交互状态和现有约束。

Backend Agent 必须判断领域实体、字段、关系、状态机、接口契约、错误码、权限、幂等、并发、数据库迁移、AI/异步任务口径。

Test Agent 必须判断 PRD 是否能拆出测试用例、测试数据、预期结果、异常路径、边界路径、回归路径和验收路径。

UI Agent 必须判断页面信息架构、主次操作、字段优先级、企业级 SaaS 后台风格、布局密度、文案语气和交互反馈。

PRD_GATE / UI_GATE 边界补充：

1. 若 UI 问题影响业务理解、页面是否存在、页面入口、主流程闭环或关键用户路径是否完整，可阻塞 PRD_GATE。
2. 若 UI 问题仅涉及视觉细化、布局细节、skeleton、组件规范、字段视觉权重或文案风格，不阻塞 PRD_GATE，应记录为 `MINOR` 或转入 `UI_DESIGN` 输入。
3. Product / Frontend / UI Agent 不得为了补视觉规范而把本应进入 `UI_DESIGN` 的问题回退成 PRD 基础不完整。

## 6. 问题分级

| severity | 含义 | Gate 行为 |
|---|---|---|
| `BLOCKER` | 会导致无法开发、无法测试、无法验收，或必须用户决策 | `PRD_GATE` 不通过；进入 `CHANGES_REQUESTED` 或 `BLOCKED` |
| `MAJOR` | 会导致方案偏差、返工、接口/数据不一致或重要测试缺失 | `PRD_GATE` 不通过；按 owner_agent 修复后复查 |
| `MINOR` | 不影响进入下一阶段，但需要记录和后续补充 | 可通过，但必须在 Gate 决策中记录跟踪 |

出现需求目标、业务状态、核心字段、接口契约、数据库口径、现有系统事实冲突、AI 输出或用户确认问题不清时，必须标记 `BLOCKER`。

## 7. Review 输出格式

所有 PRD Review 输出必须包含：

```text
# {feature-key} {agent} PRD Review Round {n}

## Review Basis

- PRD：
- PRD Review 标准：agent-loop-docs/process/prd-review-standard.md
- 当前阶段：
- 项目类型：

## Conclusion

PASS / CHANGES_REQUESTED / BLOCKED

## Findings

| issue_id | severity | owner_agent | category | source_file | target_files | problem | expected_fix | verification | blocking |
|---|---|---|---|---|---|---|---|---|---|

## Open Questions For Brain Agent

## Non-blocking Suggestions

## Self Check

- 结论：PASS / FAIL / BLOCKED
- 检查范围：
- 已完成项：
- 发现的问题：
- 是否允许进入下一阶段：是 / 否
```

## 8. PRD_GATE 判定标准

`PRD_GATE` 只有在以下条件全部满足时才允许通过：

1. Product 初审已完成，并且输出包含 `## Self Check`。
2. Frontend/Backend/Test/UI 四方 PRD Review 已完成，并且全部包含 `## Self Check`。
3. 所有 Review 都明确引用 `agent-loop-docs/process/prd-review-standard.md` 作为 Review Basis。
4. 没有 `BLOCKER` 或未处理的 `MAJOR` 问题。
5. 没有必须用户确认的开放问题。
6. 每个未关闭问题都明确 `owner_agent`、`target_files`、`expected_fix` 和 `verification`。
7. 如果 Gate 不通过，必须生成 `agent-loop-docs/issues/*.md`，并在 `workflow-state.md` 持久化 `Issue Owner Agents` / `owner_agents`。
8. 修复任务通过基础检查后必须进入 `RECHECK_REQUIRED`，不能直接进入下一阶段。
9. 同一 Gate 连续失败 3 次必须进入 `BLOCKED`，由 Brain Agent 向用户确认。
10. 但若连续失败根因是 `engine_failed`、`git_mutation_blocked`、`verifier_inconsistent`、`self_check_parse_failed`、`state_source_split` 或其他系统执行错误，必须归类为 `BLOCKED_BY_SYSTEM`，不得要求用户做业务决策。

## 9. 复查标准

进入 `RECHECK_REQUIRED` 后，复查 Agent 必须确认：Issue 中每个问题都有明确处理结果、修改没有扩大范围、PRD 或 Review 文档中的 Self Check 仍然为 PASS、原问题的 verification 可以被执行或已经执行、没有引入新的 BLOCKER / MAJOR 问题。
