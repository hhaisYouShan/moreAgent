# bossResume Agent 文档规范

> 当前 Agent Loop 运行态和产物统一放在 `agent-loop-docs/`。`docs/` 只保留 PRD、项目级架构/数据库、历史流程说明和文档规范。

## 1. 目标

本规范用于约束多 Agent 工作流中的所有文档输出，避免 PRD、评审、技术方案、测试报告、验收报告和归档记录分散或命名混乱。

所有 Agent 在输出流程文档前必须遵守本规范。当前正式流程入口以 `agent-loop-docs/README.md` 为准。

## 2. feature-key 规范

`feature-key` 用于标识一个独立需求、重构任务或交付单元。

规则：

1. 只能使用小写英文、数字和短横线。
2. 禁止中文、空格、下划线和日期。
3. 必须表达业务含义，不能使用 `task1`、`new-feature` 这类泛名。

示例：

```text
application-management
ai-template-center
data-import-center
interview-application-link
```

## 3. 目录规范

当前 Agent Loop 进行中的正式交付文档放在：

```text
agent-loop-docs/reviews/
agent-loop-docs/decisions/
agent-loop-docs/tech/
agent-loop-docs/gate-results/
agent-loop-docs/issues/
agent-loop-docs/test-reports/
agent-loop-docs/acceptance/
agent-loop-docs/archive/
```

正式 PRD 放在：

```text
docs/prd/
```

历史开发过程、模板、快速记录和规则可继续放在：

```text
.codex/dev/
```

## 4. 命名规范

| 文档类型 | 推荐命名格式 |
|---|---|
| PRD | `docs/prd/{feature-key}-prd.md` |
| PRD Review | `agent-loop-docs/reviews/{feature-key}-{role}-prd-review-round-{round}.md` |
| UI 设计 | `agent-loop-docs/tech/{feature-key}-ui-design-spec-v{round}.md` |
| 前端开发设计 | `agent-loop-docs/tech/{feature-key}-frontend-dev-plan-v{round}.md` |
| 后端开发设计 | `agent-loop-docs/tech/{feature-key}-backend-dev-plan-v{round}.md` |
| 测试设计 | `agent-loop-docs/tech/{feature-key}-test-plan-v{round}.md` |
| Gate Result | `agent-loop-docs/gate-results/{feature-key}-{task}-round-{round}.json` |
| Gate 决策 | `agent-loop-docs/decisions/{feature-key}-{gate-name}-round-{round}.md` |
| Issue Routing | `agent-loop-docs/issues/{feature-key}-issues-round-{round}.md` |
| 测试报告 | `agent-loop-docs/test-reports/{feature-key}-test-execution-round-{round}.md` |
| 修复报告 | `agent-loop-docs/test-reports/{feature-key}-{owner}-repair-round-{round}.md` |
| 产品验收 | `agent-loop-docs/acceptance/{feature-key}-product-acceptance-v{round}.md` |
| 用户验收 | `agent-loop-docs/acceptance/{feature-key}-user-acceptance-v{round}.md` |
| 归档 | `agent-loop-docs/archive/{feature-key}/round-{round}/` |

## 5. YAML 元信息

建议流程文档顶部包含：

```yaml
---
feature: application-management
doc_type: prd-review
status: REVIEWING
round: 1
owner_agent: backend_agent
created_at: 2026-07-07
updated_at: 2026-07-07
---
```

`status` 只允许：

```text
DRAFT
REVIEWING
CHANGES_REQUESTED
APPROVED
BLOCKED
ARCHIVED
```

## 6. PRD 文档结构

PRD 必须包含：背景与目标、功能类型总览、核心实体和实体关系、状态机与生命周期、页面输入输出或服务输入输出、API 规范、数据库影响、异常处理、幂等和并发控制、非功能需求、验收标准、明确不做范围、待确认问题。

## 7. 技术方案结构

前端技术方案必须包含页面范围、路由和导航影响、组件拆分、状态管理、API 依赖、表格/表单/弹窗/空态/加载态/错误态、兼容和回归风险、验证命令。

后端技术方案必须包含模块边界、API 契约、DTO 和错误码、数据库表/字段/索引/迁移、事务边界、幂等与并发控制、权限和用户隔离、兼容策略、验证命令。

测试方案必须包含测试范围、正常路径、异常路径、边界路径、兼容路径、回归路径、测试数据、通过标准。

## 8. Review 问题格式

每个问题必须包含：

| 字段 | 说明 |
|---|---|
| `issue_id` | 问题编号 |
| `severity` | `BLOCKER` / `MAJOR` / `MINOR` |
| `owner_agent` | 建议处理 Agent |
| `category` | 问题分类 |
| `source_file` | 问题来源文件 |
| `target_files` | 预计修改文件 |
| `problem` | 问题描述 |
| `expected_fix` | 建议修复方式 |
| `verification` | 验证方式 |
| `blocking` | 是否阻塞 Gate |

## 9. Gate 决策格式

Gate 决策必须包含 Gate 名称、评审轮次、输入文档、参与 Agent、通过项、未通过项、Blocker 列表、最终结论、下一步 Agent、下一步指令、Self Check。

每个 Agent 还必须输出 `agent-loop-docs/gate-results/*.json`，供 Gate 优先读取。

## 10. 归档规范

用户最终验收通过后，Brain Agent 归档到：

```text
agent-loop-docs/archive/{feature-key}/round-{round}/
```

归档后，`agent-loop-docs/process/workflow-state.md` 必须更新为已完成或归档完成状态，并记录归档路径。
