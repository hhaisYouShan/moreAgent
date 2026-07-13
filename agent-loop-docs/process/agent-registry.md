# bossResume Agent Registry

本文档定义 bossResume 全自动 Agent Loop 使用的正式 Agent 名称、职责、输入、输出和允许修改范围。

## 1. 正式角色表

| 正式 Agent | 核心职责 | 默认输出 | 是否可写代码 |
|---|---|---|---|
| `brain_agent` | 和用户讨论方案、确认 PRD、维护状态、分派任务、汇总问题、控制 loop、用户验收准备、归档 | `agent-loop-docs/process/brain-discussion.md`, `agent-loop-docs/process/workflow-state.md`, `agent-loop-docs/process/confirmed-decisions.json`, `agent-loop-docs/archive/*`, `agent-loop-docs/gate-results/*brain*.json` | 否 |
| `product_agent` | PRD 初审、汇总多方 PRD Review、修订建议、产品验收 | `agent-loop-docs/reviews/*product*.md`, `agent-loop-docs/acceptance/*product*.md`, `agent-loop-docs/gate-results/*product*.json` | 默认否；仅 `direct_edit` 且任务列出 PRD editable file 时可改 PRD |
| `ui_agent` | PRD UI 评审、UI 设计文档、UI 专项设计评审 | `agent-loop-docs/tech/*ui-design*.md`, `agent-loop-docs/reviews/*ui*.md`, `agent-loop-docs/gate-results/*ui*.json` | 否 |
| `frontend_architect_agent` | 新项目前端架构设计、前端架构验收、已有重构项目前端 `ARCHITECTURE_IMPACT_REVIEW`、前端专项设计评审 | `agent-loop-docs/tech/*frontend-architecture*.md`, `agent-loop-docs/reviews/*frontend-architecture-impact*.md`, `agent-loop-docs/gate-results/*frontend*.json` | 否 |
| `backend_architect_agent` | 新项目后端架构设计、后端架构验收、已有重构项目后端 `ARCHITECTURE_IMPACT_REVIEW`、后端专项设计评审 | `agent-loop-docs/tech/*backend-architecture*.md`, `agent-loop-docs/reviews/*backend-architecture-impact*.md`, `agent-loop-docs/gate-results/*backend*.json` | 否 |
| `frontend_agent` | PRD 前端评审、前端开发设计、前端原子任务实现和自测 | `agent-loop-docs/tech/*frontend-dev-plan*.md`, `client/**`, `agent-loop-docs/test-reports/*frontend*.md`, `agent-loop-docs/gate-results/*frontend*.json` | 仅 `IMPLEMENTATION/REPAIR` |
| `backend_agent` | PRD 后端评审、后端开发设计、后端原子任务实现和自测 | `agent-loop-docs/tech/*backend-dev-plan*.md`, `server/**`, `agent-loop-docs/test-reports/*backend*.md`, `agent-loop-docs/gate-results/*backend*.json` | 仅 `IMPLEMENTATION/REPAIR` |
| `test_agent` | PRD 可测性评审、架构影响可测性评审、测试设计、测试执行、缺陷汇总、回归复查 | `agent-loop-docs/tech/*test-plan*.md`, `agent-loop-docs/reviews/*architecture-impact-testability*.md`, `agent-loop-docs/test-reports/*`, `agent-loop-docs/gate-results/*test*.json` | 仅 planner 授权的测试文件范围 |
| `review_agent` | 跨文档一致性审查、遗漏审查、原子任务质量审查、综合风险审查、修复后复查 | `agent-loop-docs/reviews/*review*.md`, `agent-loop-docs/gate-results/*review*.json` | 否 |
| `repair_agent` | 只处理已分派问题，最小修复并回归 | `agent-loop-docs/test-reports/*repair*.md`, `agent-loop-docs/gate-results/*repair*.json`, 相关代码 | 仅 `REPAIR` |

## 2. 总 Agent 边界

`brain_agent` 是可对话总大脑，只负责：

- 和用户讨论方案。
- 确认执行哪份 PRD。
- 确认项目类型：`existing_refactor` / `new_project`。
- 维护 `agent-loop-docs/process/workflow-state.md`。
- 记录讨论结论到 `agent-loop-docs/process/brain-discussion.md`。
- 维护已确认决策到 `agent-loop-docs/process/confirmed-decisions.json`。
- 根据 Gate 和 Issue 分派子 Agent。
- 收集问题、归类问题、推进或停止 loop。
- 准备用户验收材料。
- 用户明确验收通过后安排归档。

`brain_agent` 禁止编写业务代码、替其他 Agent 产出正式文档或代码、在需求不清时自行脑补推进、跳过 Self Check、Gate、`gate_result.json` 或必要复查。

用户验收硬边界：没有用户明确确认记录，`brain_agent` 不得把 `USER_ACCEPTANCE_GATE` 判定为 PASS；产品验收、测试通过、Review 通过都不能代替用户验收。

## 3. 统一输入基线

所有 Agent 默认先读取：

- `AGENTS.md`
- `docs/README.md`
- `agent-loop-docs/README.md`
- `agent-loop-docs/process/workflow-state.md`
- `agent-loop-docs/process/agent-registry.md`
- `agent-loop-docs/process/gate-matrix.md`
- `agent-loop-docs/process/brain-loop-protocol.md`
- `agent-loop-docs/process/prd-review-standard.md`
- `workflow-state.md` 中记录的 PRD 路径

PRD Review 相关阶段必须以 `agent-loop-docs/process/prd-review-standard.md` 作为统一评审标准；Product/Frontend/Backend/Test/UI 的 Review 输出必须在 Review Basis 中显式引用该文件。

## 4. 核心流程规则

1. Brain Agent 只管流程，不写业务代码。
2. Product Agent 默认不直接改 PRD；只有 `PRD 修改模式：direct_edit` 且任务列出 editable files 时才允许。
3. `PRD 修改模式` 可通过 `npm run agent:state -- --prd-edit-mode=direct_edit` 或 `review_only` 切换。
4. PRD Review 固定由 `frontend_agent`、`backend_agent`、`test_agent`、`ui_agent` 四方参与。
5. 新项目执行 `ARCHITECTURE_DESIGN` 和 `ARCHITECTURE_REVIEW`；已有重构项目执行轻量 `ARCHITECTURE_IMPACT_REVIEW`。
6. UI Agent 必须输出页面结构与视觉规范。
7. Frontend/Backend/Test 设计文档必须包含原子任务。
8. DESIGN_REVIEW 六个角色必须按非重叠边界检查，不允许互相替代专项审查。
9. 设计文档评审不通过必须打回重写，再次评审。
10. 实现阶段必须严格按设计文档和原子任务执行，每个任务先自测。
11. Test Agent 汇总缺陷后交给 Brain Agent 分派；Test Agent 只可在 planner 授权范围内修改测试文件，禁止改业务实现。
12. Product 验收通过后才进入用户验收。
13. 用户验收必须由用户明确确认，且 `gate_result.json` 包含 `user_confirmed: true`、`confirmed_by: "user"`、`confirmed_at`。
14. 用户验收通过后才归档。

## 5. DESIGN_REVIEW 非重叠边界

| Agent | 只检查 | 禁止越界 |
|---|---|---|
| `product_agent` | PRD 覆盖、产品目标、验收条件、需求偏差、范围漂移 | 不审查 UI 视觉、前端架构、后端架构、测试实现 |
| `ui_agent` | 视觉规范、交互流程、页面状态、字段优先级、UI 设计落地一致性 | 不审查产品范围、接口契约、数据库、测试覆盖 |
| `test_agent` | 可测性、测试覆盖、测试数据、预期结果、异常路径、回归范围 | 不审查产品目标、视觉设计、前端架构、后端架构 |
| `frontend_architect_agent` | 前端架构、路由、组件边界、状态管理、接口接入、前端原子任务 | 不审查产品验收、视觉审美、后端表结构、测试用例细节 |
| `backend_architect_agent` | 后端架构、接口契约、数据模型、权限、幂等、迁移、后端原子任务 | 不审查视觉体验、前端组件实现、测试用例细节 |
| `review_agent` | 跨文档一致性、遗漏、原子任务质量、超范围实现风险、综合进入实现风险 | 不替专项 Agent 做领域审查，不修复问题 |

## 6. Gate 与回流规则

| Gate | 失败后默认 owner | 复查 Agent |
|---|---|---|
| `PRD_GATE` | `product_agent` | `frontend_agent`, `backend_agent`, `test_agent`, `ui_agent`, `review_agent` |
| `ARCHITECTURE_GATE` | `frontend_architect_agent`, `backend_architect_agent`, `test_agent` | `frontend_architect_agent`, `backend_architect_agent`, `test_agent`, `review_agent` |
| `UI_GATE` | `ui_agent` | `ui_agent`, `review_agent` |
| `DESIGN_GATE` | Product/UI/Frontend/Backend/Test/Architect 中对应责任 Agent | `product_agent`, `ui_agent`, `test_agent`, `frontend_architect_agent`, `backend_architect_agent`, `review_agent` |
| `TEST_GATE` | `frontend_agent`, `backend_agent`, `test_agent`, `repair_agent` | `test_agent`, `review_agent` |
| `PRODUCT_ACCEPTANCE_GATE` | `product_agent` 或对应实现 Agent | `product_agent`, `test_agent` |
| `USER_ACCEPTANCE_GATE` | `brain_agent` 分派 | `brain_agent` |
| `ARCHIVE_GATE` | `brain_agent` | `brain_agent` |

结构/格式类问题修复通过后可以跳过额外复查；业务、架构、接口、数据库、实现、测试类问题仍必须进入 `RECHECK_REQUIRED`。

## 7. Self Check 规则

每个 Agent 输出文件末尾必须包含 Self Check，并且还必须输出结构化 `gate_result.json` 到 `agent-loop-docs/gate-results/`。缺少 Self Check、Self Check 为 FAIL/BLOCKED、`是否允许进入下一阶段` 为否、缺少 `gate_result.json`、或结构化结论不是 PASS 时，Gate 不得通过。

## 8. Issue Routing 规则

Gate 不通过时，Brain Orchestrator 必须生成结构化 issue，并写入 `agent-loop-docs/issues/`。

Issue 必须包含：`issue_id`、`issue_signature`、`gate`、`severity`、`decision_type`、`owner_agent`、`source_file`、`target_files`、`problem`、`expected_fix`、`verification`、`status`。

`workflow-state.md` 必须持久化 `Issue Owner Agents` / `owner_agents`，下一轮 planner 必须优先按 owner 分派修复任务。

`repair_agent` 是兜底修复 Agent，只在 Issue 明确指定 `owner_agent=repair_agent`，或 `REPAIR` 阶段没有更具体责任 Agent 可分派时使用。普通前端、后端、测试、UI、架构、产品问题应优先回流给对应责任 Agent；`repair_agent` 不替代责任 Agent 的领域修复职责。

## 9. 原子任务规则

开发设计文档中的每个原子任务必须包含 `task_id`、输入依据、改动文件、验收标准、自测命令、回滚方式。实现阶段必须按原子任务逐个执行；每个原子任务完成自测后，才能进入下一个任务。

## 10. 代码集成规则

1. 实现阶段每个子 Agent 使用独立 git worktree。
2. Gate 通过后，短期会复制已通过的 `client/` / `server/` / `tests/` / `e2e/` 授权改动回主工作树，供后续 TESTING / ACCEPTANCE 预加载。
3. 同时维护 `agent/integration/<feature>` integration branch 和 `.agent-worktrees/integration-<feature>`，作为后续更严格的集成分支。
4. 如果多个 Agent 修改同一代码文件，Gate 生成 `code_integration_conflict`，由 Brain Agent 决策 owner 后再继续。
5. 默认不直接 merge 到 `master`。

## 11. 停止条件

出现以下情况必须停止自动推进，进入 `BLOCKED`：需求或接口不清、Agent 输出 BLOCKED、同一 Gate 连续失败 3 次、环境预检失败、文档阶段试图修改 `client/` 或 `server/`、结构化 Gate Result 存在 `open_questions` 或 `blockers`、用户明确要求暂停或重新确认方向、USER_ACCEPTANCE_GATE 缺少用户确认记录。
