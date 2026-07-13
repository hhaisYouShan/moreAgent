# bossResume Gate Matrix

本文档定义终端全自动 Agent Loop 每个 Gate 的输入、输出、决策者、通过标准和回流点。Brain Orchestrator 必须按本表推进流程。

核心原则：`brain_agent` / Brain Orchestrator 是总大脑，只负责和用户讨论方案、确认问题、维护状态、分派子 Agent、控制 loop 和归档；它没有业务代码编写权。

## 1. Gate 状态

| 状态 | 含义 | 下一步 |
|---|---|---|
| `DRAFT` | 当前阶段尚未执行或刚进入新阶段 | 按 `workflow-state.md` 规划子 Agent 任务 |
| `APPROVED` | 当前 Gate 通过 | 更新 `workflow-state.md`，进入下一阶段 |
| `CHANGES_REQUESTED` | 有明确问题需要责任 Agent 修改 | 生成 issue，按 `owner_agent` 分派修复 |
| `RECHECK_REQUIRED` | 修复基础检查通过，但尚未复查 | 启动 Review/Test/对应审核 Agent 复查 |
| `BLOCKED` | 缺少用户决策、环境不可用、需求不清或连续失败 3 次 | 必须继续区分是 `NEEDS_USER` 还是 `BLOCKED_BY_SYSTEM`；前者由 Brain Agent 向用户提问，后者先修 Agent Loop |

## 2. Gate 执行总表

| Gate | 覆盖阶段 | 输入文件 | 输出文件 | 决策者 | 通过标准 | 不通过回流 |
|---|---|---|---|---|---|---|
| `PRD_GATE` | `PRODUCT_REVIEW`, `PRD_REVIEW` | PRD、`agent-loop-docs/process/prd-review-standard.md`、Product/FE/BE/Test/UI Review、`agent-loop-docs/gate-results/*.json` | `agent-loop-docs/decisions/{feature}-prd-gate-round-{n}.md` | `brain_agent` 汇总判定 | 必须符合 PRD Review 标准；所有 `gate_result.json` 结论为 PASS；没有 `issues[].status=OPEN`；没有 `open_questions[]` | `AUTO_FIXABLE` 自动回流给 owner；仅 `HUMAN_DECISION_REQUIRED` 才停止到用户侧；系统错误转 `BLOCKED_BY_SYSTEM` |
| `ARCHITECTURE_GATE` | `ARCHITECTURE_DESIGN`, `ARCHITECTURE_REVIEW`, `ARCHITECTURE_IMPACT_REVIEW` | 架构设计、架构验收、架构影响评审、测试可测性 Review、`agent-loop-docs/gate-results/*.json` | `agent-loop-docs/decisions/{feature}-architecture-gate-round-{n}.md` | `brain_agent` 汇总判定 | 新项目要求边界、模块、契约、数据流、风险明确；已有重构项目要求现有架构影响面、兼容风险、迁移影响和可测性明确 | 对应架构 Agent 或 Test Agent 修改，修完后复查 |
| `UI_GATE` | `UI_DESIGN` | UI 设计文档、PRD、架构/已有系统约束、`agent-loop-docs/gate-results/*.json` | `agent-loop-docs/decisions/{feature}-ui-gate-round-{n}.md` | `brain_agent` 汇总判定 | 页面结构、视觉规范、交互状态、组件规范、适配和异常状态明确 | `ui_agent` 修改 UI 设计文档；修完后复查 |
| `DESIGN_GATE` | `DEVELOPMENT_DESIGN`, `DESIGN_REVIEW` | UI/FE/BE/Test 设计文档、联审 Review、`agent-loop-docs/gate-results/*.json` | `agent-loop-docs/decisions/{feature}-design-gate-round-{n}.md` | `brain_agent` 汇总判定 | 设计覆盖 PRD；前后端契约一致；测试方案可执行；任务拆分为原子级任务；每个原子任务有自测标准；六个 Review 角色没有越界代审 | 按 issue owner 分派；修完后按 issue 类型决定是否复查 |
| `TEST_GATE` | `IMPLEMENTATION`, `TESTING`, `REPAIR` | 实现结果、自测报告、测试报告、缺陷报告、修复报告、integration branch、`agent-loop-docs/gate-results/*.json` | `agent-loop-docs/decisions/{feature}-test-gate-round-{n}.md` | `brain_agent` + `test_agent` | 构建、类型检查、相关测试、冒烟测试通过；阻塞缺陷关闭；实现改动无自动集成冲突；Test Agent 未越权修改业务实现 | Brain 按缺陷 owner 分派给 Frontend/Backend/Test/Repair Agent；修完后回到测试复查 |
| `PRODUCT_ACCEPTANCE_GATE` | `PRODUCT_ACCEPTANCE` | PRD、实现说明、测试报告、产品验收报告、`agent-loop-docs/gate-results/*.json` | `agent-loop-docs/acceptance/{feature}-product-acceptance-v{n}.md` | `product_agent` + `brain_agent` | 产品逐条对照 PRD 验收通过；测试报告通过；无未确认需求偏差；无阻塞体验问题或遗留问题 | 对应责任 Agent 修复；修完后复查并重新验收 |
| `USER_ACCEPTANCE_GATE` | `USER_ACCEPTANCE` | 产品验收报告、用户确认记录、`agent-loop-docs/process/confirmed-decisions.json`、`agent-loop-docs/process/brain-conversation.jsonl`、`agent-loop-docs/gate-results/*.json` | `agent-loop-docs/acceptance/{feature}-user-acceptance-v{n}.md` | 用户 + `brain_agent` | 用户明确确认通过；确认记录必须由 CLI `/accept` 写入；`gate_result.json`、`confirmed-decisions.json`、`brain-conversation.jsonl` 必须严格匹配 `feature_key`、`task_id`、`round`、`confirmed_at` | 没有严格匹配的用户确认记录时必须 BLOCKED，`decision_type=HUMAN_DECISION_REQUIRED`，由 Brain Agent 提示用户执行 `/accept` |
| `ARCHIVE_GATE` | `ARCHIVE` | 全部 PRD/设计/Review/测试/产品验收/用户验收/决策/Issue/Gate Result 文件 | `agent-loop-docs/archive/{yyyy-mm-dd}-{feature}/` | `brain_agent` | 归档完整；必须存在通过的用户确认记录；`workflow-state.md` 标记完成或归档完成 | 补齐缺失文档后重新归档 |

## 3. 结构化 Gate Result

每个 Agent 必须输出 `agent-loop-docs/gate-results/{feature}-{task}-round-{n}.json`。Gate 的当前阻塞、当前问题、是否需要用户决策，必须以该 JSON 为事实来源。

Markdown 产物只作为说明材料和结构性检查来源，Gate 不允许通过全文正则扫描 Markdown 里的 `BLOCKER` / `MAJOR` / `Open Questions` 来判断当前阻塞。

```json
{
  "task_id": "...",
  "round": 1,
  "agent": "...",
  "phase": "...",
  "conclusion": "PASS | CHANGES_REQUESTED | BLOCKED",
  "issues": [
    {
      "severity": "BLOCKER | MAJOR",
      "status": "OPEN | CLOSED",
      "decision_type": "AUTO_FIXABLE | HUMAN_DECISION_REQUIRED",
      "owner_agent": "product_agent",
      "issue_type": "specific_issue_type",
      "target_files": [],
      "problem": "当前仍未解决的问题，只写当前问题，不写历史描述",
      "expected_fix": "需要怎么修",
      "verification": "Gate 如何验证"
    }
  ],
  "open_questions": [],
  "owner_agents": [],
  "target_files": [],
  "verification": "..."
}
```

`USER_ACCEPTANCE` 阶段若要 PASS，必须额外包含，并且必须与 CLI `/accept` 写入的记录完全一致：

```json
{
  "task_id": "bossresume-full-refactor-user-acceptance-round-12",
  "round": 12,
  "user_confirmed": true,
  "confirmed_by": "user",
  "confirmed_at": "YYYY-MM-DD HH:mm:ss 北京时间"
}
```

`agent-loop-docs/process/confirmed-decisions.json` 中对应记录必须包含：

```json
{
  "type": "USER_ACCEPTANCE",
  "feature_key": "bossresume-full-refactor",
  "task_id": "bossresume-full-refactor-user-acceptance-round-12",
  "round": 12,
  "user_confirmed": true,
  "confirmed_by": "user",
  "source": "user",
  "source_channel": "agent_cli",
  "status": "CONFIRMED",
  "confirmed_at": "YYYY-MM-DD HH:mm:ss 北京时间"
}
```

规则：

1. `conclusion=PASS` 时，`issues[]` 中不得存在 `status=OPEN` 的项，`open_questions[]` 必须为空。
2. 历史问题、复查说明、已解决问题必须写成 `status=CLOSED` / `RESOLVED` / `DONE` / `FIXED`，不能作为当前问题。
3. `issues[].decision_type` 必须显式填写。缺失时按 `AUTO_FIXABLE` 结构错误回流给 owner Agent，不允许通过关键词猜测是否需要用户决策。
4. 只有 `decision_type=HUMAN_DECISION_REQUIRED` 或 `open_questions[]` 非空时，流程才停止到用户侧。
5. `USER_ACCEPTANCE_GATE` 没有严格匹配的用户确认记录时不得 PASS；产品验收、测试通过、Brain Agent 判断都不能代替用户确认。
6. USER_ACCEPTANCE 确认记录必须由聊天入口 `/accept` 或 CLI `npm run agent -- accept` 直接从用户原始输入落盘；模型不得自由生成。

## 4. DESIGN_REVIEW 六角色边界

| Agent | 只检查 | 禁止越界 |
|---|---|---|
| `product_agent` | PRD 覆盖、产品目标、验收条件、需求偏差、范围漂移 | 不审查 UI 视觉、前端架构、后端架构、测试实现 |
| `ui_agent` | 视觉规范、交互流程、页面状态、字段优先级、UI 设计落地一致性 | 不审查产品范围、接口契约、数据库、测试覆盖 |
| `test_agent` | 可测性、测试覆盖、测试数据、预期结果、异常路径、回归范围 | 不审查产品目标、视觉设计、前端架构、后端架构 |
| `frontend_architect_agent` | 前端架构、路由、组件边界、状态管理、接口接入、前端原子任务 | 不审查产品验收、视觉审美、后端表结构、测试用例细节 |
| `backend_architect_agent` | 后端架构、接口契约、数据模型、权限、幂等、迁移、后端原子任务 | 不审查视觉体验、前端组件实现、测试用例细节 |
| `review_agent` | 跨文档一致性、遗漏、原子任务质量、超范围实现风险、综合进入实现风险 | 不替专项 Agent 做领域审查，不修复问题 |

## 5. PRD Review 标准

`PRODUCT_REVIEW`、`PRD_REVIEW` 和 `PRD_GATE` 必须引用并执行 `agent-loop-docs/process/prd-review-standard.md`。

PRD_GATE 额外检查：

1. Product Review 和 FE/BE/Test/UI 四方 Review 的 Review Basis 都必须列出 `agent-loop-docs/process/prd-review-standard.md`。
2. 所有当前问题必须在 `gate_result.json` 的 `issues[]` 中结构化表达，并带 `status`、`decision_type`、`owner_agent`、`target_files`、`expected_fix`、`verification`。
3. 存在必须用户确认的问题时，必须写 `decision_type=HUMAN_DECISION_REQUIRED` 或放入 `open_questions[]`。
4. Gate 不通过时，生成的 `agent-loop-docs/issues/*.md` 必须能按 `owner_agent` 分派修复。
5. 修复基础检查通过后按 issue 类型决定是否进入 `RECHECK_REQUIRED`。
6. `failure_reason=engine_failed|git_mutation_blocked|verifier_inconsistent|self_check_parse_failed|state_source_split` 时，不得转为 `NEEDS_USER`；必须标记为系统阻塞并优先修 Agent Loop / Gate / runner。
7. `human_issue_count=0` 且仍有问题时，不得推荐 `/decide`；要么 `NEEDS_FIX` 自动回流，要么 `BLOCKED_BY_SYSTEM`。

PRD_GATE 与 UI_GATE 边界：

1. PRD_GATE 只判断 PRD 是否足够进入多方 PRD Review，以及业务流程、实体/状态机、接口边界、权限/异常/验收是否明确。
2. 会影响“页面是否存在、入口是否完整、主流程是否闭环”的 UI 问题，仍可阻塞 PRD_GATE。
3. 纯视觉细化、布局密度、skeleton、组件规范、字段视觉权重、文案风格模板，不得阻塞 PRD_GATE；应转入 `UI_DESIGN` / `UI_GATE` / `DEVELOPMENT_DESIGN`。

## 6. Self Check 要求

每个 Agent 完成任务后必须在输出文件末尾写：

```text
## Self Check

- 结论：PASS / FAIL / BLOCKED
- 检查范围：
- 已完成项：
- 发现的问题：
- 是否允许进入下一阶段：是 / 否
```

阶段级 Self Check 还必须满足 `scripts/agent-loop/self-check-policy.mjs` 的关键字段要求。

| 阶段 | 必须覆盖 |
|---|---|
| `PRODUCT_REVIEW` | PRD、问题清单、修改建议、需要用户确认 |
| `PRD_REVIEW` | 评审结论、问题清单、是否阻塞 |
| `ARCHITECTURE_DESIGN` | 架构设计、边界、风险、验收标准 |
| `ARCHITECTURE_REVIEW` | 架构验收、风险、是否通过 |
| `ARCHITECTURE_IMPACT_REVIEW` | 现有架构、影响范围、风险、是否通过 |
| `UI_DESIGN` | 页面结构、视觉规范、交互状态、组件规范 |
| `DEVELOPMENT_DESIGN` | 设计方案、原子任务、实施计划、自测标准、风险 |
| `DESIGN_REVIEW` | 评审结论、问题清单、产品需求、原子任务 |
| `IMPLEMENTATION` | 原子任务、设计文档、变更范围、自测命令、测试结果 |
| `TESTING` | 测试范围、测试结果、缺陷汇总、总 Agent |
| `PRODUCT_ACCEPTANCE` | PRD 逐条对照、测试报告引用、需求偏差、体验验收、遗留问题、是否允许进入 USER_ACCEPTANCE |
| `USER_ACCEPTANCE` | 用户验收、检查清单、确认项、用户明确确认、用户确认记录 |

## 7. Issue Owner Agents 与回流规则

Gate 不通过时，Brain Orchestrator 必须生成 issue，并包含 `issue_id`、`issue_signature`、`gate`、`severity`、`decision_type`、`owner_agent`、`source_file`、`target_files`、`problem`、`expected_fix`、`verification`、`status`。

`workflow-state.md` 必须持久化 `Issue Owner Agents` / `owner_agents`，下一轮 planner 必须优先按 owner 分派修复任务。

结构/格式类问题修复通过后可以跳过额外复查；业务、架构、接口、数据库、实现、测试类问题仍必须进入 `RECHECK_REQUIRED`。
