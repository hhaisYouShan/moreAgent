# Agent Loop Runner

这是 bossResume 的终端版多 Agent 执行器。

核心原则：`brain_agent` 是可对话总大脑，负责跟你讨论方案、确认问题、维护流程、安排子 Agent 干活；它没有编写业务代码的权利。

Agent Loop 的运行态、流程协议、Gate 结果、Issue、Review、技术方案、测试报告、验收和归档统一放在 `agent-loop-docs/`。产品 PRD 仍放在 `docs/prd/`。

## 全局用户体验规则

- 所有用户可见时间统一使用北京时间，展示格式为 `YYYY-MM-DD HH:mm:ss`，例如 `2026-07-08 14:30:00`。
- 状态卡、对话框、运行摘要、完成状态、Gate 决策说明等给用户看的内容尽量使用中文。
- Agent 名称、文件路径、命令、Gate 状态等技术标识可以保留英文原文，但解释说明必须使用中文。

## 用户日常命令

```bash
npm run agent -- start docs/prd/bossresume-full-refactor-prd.md
npm run agent -- chat
npm run agent -- status
npm run agent -- jobs
npm run agent -- watch
npm run agent -- logs
npm run agent -- logs raw
npm run agent -- next --preview
npm run agent -- next
npm run agent -- next --foreground
npm run agent -- next --mode=single
npm run agent -- next --mode=auto --max-loops=10
npm run agent -- doctor
```

## 常驻对话框

`npm run agent -- chat` 默认不会一轮结束就退出，而是进入长期挂着的 Brain Agent 对话框。

对话框内部命令：

```text
/status   查看当前状态卡
/jobs     查看当前运行任务
/watch    持续刷新运行状态
/logs     查看结构化事件；可用 /logs raw 查看原始日志
/preview  预览下一轮 Agent，不真正执行；可用 /preview --fresh-worktree
/next     后台执行下一轮 Agent Loop；旧 worktree 时用 /next --fresh-worktree；前台执行用 /next --foreground
/doctor   执行系统自检
/history  查看最近对话；可用 /history --limit=50
/clear    清屏并重新显示状态
/help     查看命令帮助
/exit     退出常驻对话框
```

普通文字会作为轻量问题发送给 `brain_agent`。轻量聊天不会输出 Self Check、环境检查、Prompt 路径和长状态卡。`npm run agent -- chat --once "你的问题"` 是中等长度的决策聊天；只有显式加 `--formal-report` 才输出报告式 Self Check。

对话历史会追加写入：

```text
agent-loop-docs/process/brain-conversation.jsonl
```

已确认决策会写入：

```text
agent-loop-docs/process/confirmed-decisions.json
```

主 Agent 判断时，`confirmed-decisions.json` 优先级高于历史聊天，避免旧聊天上下文污染当前决策。

## 运行状态看板

真实运行时会写入：

```text
.agent-runs/current-run.json
.agent-runs/current-tasks.json
.agent-runs/current-events.jsonl
```

`/jobs` 读取当前运行态，显示状态、步骤、模式、最大轮数、父进程 PID、子 Agent、日志、产物和最近事件。

`/logs` 默认读取结构化事件摘要，不再只靠原始日志 tail 关键字过滤。

`/logs raw` 才读取子 Agent 原始日志。

## 执行模式

```text
--mode=auto      自动推进到通过、需要用户决策或达到安全上限
--mode=single    只执行一轮
--mode=cautious  等同单轮，用于审慎推进
```

默认模式是 `auto`，默认安全上限是 10 轮。可以通过 `--max-loops=N` 或 `AGENT_LOOP_MAX_LOOPS=N` 调整。

CLI 和常驻框行为已经统一：`npm run agent -- next` 和 `/next` 默认都后台执行。前台阻塞执行统一使用：

```bash
npm run agent -- next --foreground
```

## 子 Agent 命名

子 Agent 窗口标题和日志会使用人能看懂的名字，例如：

```text
产品初审｜Product Agent｜第 1 轮
前端 PRD 评审｜Frontend Agent｜第 2 轮
后端架构影响评审｜Backend Architect｜第 1 轮
测试执行｜Test Agent｜第 3 轮
```

机器 ID 仍然保留，例如：

```text
bossresume-full-refactor-product-review-round-1
```

OpenCode 原生 Agent 默认开启。需要关闭时设置：

```bash
AGENT_LOOP_OPENCODE_NATIVE_AGENT=false npm run agent -- next
```

## 自动推进规则

Issue 会被分成两类：

```text
AUTO_FIXABLE
HUMAN_DECISION_REQUIRED
```

默认不需要用户确认的问题会自动回流给责任 Agent，例如缺输出文件、缺 Self Check、`gate_result.json` 格式问题、文档结构问题。

只有结构化 `gate_result.json` 明确写出 `decision_type=HUMAN_DECISION_REQUIRED`，或存在真正的用户业务决策问题时，才会停到用户侧。

Issue 会带 `issue_signature` 和 `repeat_count`，用于识别同一个根因是否反复失败。

结构/格式类问题修复通过后，可以跳过额外复查直接推进；业务、架构、接口、数据库、实现、测试类问题修复后仍进入 `RECHECK_REQUIRED`。

## Gate Result

每个 Agent 除 Markdown Self Check 外，还必须输出 `agent-loop-docs/gate-results/*.json`。

Gate 的当前问题、当前阻塞、是否需要用户决策，只以结构化 `gate_result.json` 为事实来源。Markdown 只做结构性检查，不再全文扫描 `BLOCKER`、`MAJOR`、`Open Questions` 来判断当前阻塞。

## Warp 等待行为

父进程会等待每个子 Agent 写出 `status.json`。等待期间用 `/jobs` 和 `/logs` 观察。

默认等待超时为 60 分钟。可以调整：

```bash
npm run agent -- next --task-timeout-minutes=10
AGENT_LOOP_TASK_TIMEOUT_MINUTES=10 npm run agent -- next
```

## Worktree 安全机制

每个子 Agent 都在 `.agent-worktrees/{task-id}` 独立 worktree 中执行。新版本会在启动子 Agent 前校验 worktree 是否包含当前 Agent Loop 必需协议文件，例如：

```text
agent-loop-docs/process/workflow-state.md
agent-loop-docs/process/prd-review-standard.md
agent-loop-docs/process/completion-status.md
```

如果检测到旧 worktree 还停留在 `docs/process` 等旧结构，执行器会自动移除旧 worktree 和对应 `agent/{task-id}` 分支，并从当前主分支重建。你也可以手动强制重建：

```text
/next --fresh-worktree
```

## 高级维护命令

这些命令保留给调试和维护，不作为日常主入口：

```bash
npm run agent:brain
npm run agent:state
npm run agent:loop
npm run agent:loop:dry-run
npm run agent:loop:verify
npm run agent:loop -- --mode=auto --max-loops=10
npm run agent:loop -- --fresh-worktree
```

## 完整流程

1. 你确认 PRD 后，Brain Agent 确认执行哪份 PRD。
2. Product Agent 对 PRD 初次审查，发现问题并汇总；不清楚的问题通过 Brain Agent 向你确认；可直接修的按 PRD 修改模式处理。
3. Product Agent 确认 PRD 后，Frontend/Backend/Test/UI 四方 PRD Review。
4. 多方 Review 提出问题后，Product Agent 根据汇总问题修改 PRD 或输出修改建议，再次 Review。
5. 如果是新项目，进入 `ARCHITECTURE_DESIGN` / `ARCHITECTURE_REVIEW`；如果是已有重构项目，进入轻量 `ARCHITECTURE_IMPACT_REVIEW`。
6. UI Agent 输出 UI 设计文档：页面结构与视觉规范。
7. Frontend Agent 输出前端开发设计，Backend Agent 输出后端开发设计，Test Agent 输出测试设计；设计文档必须包含原子级任务。
8. Product/UI/Test/Architect/Review Agent 评审设计文档是否符合规范、是否满足产品需求、任务是否原子化。
9. 未通过则按 `AUTO_FIXABLE` 自动回流；仅 `HUMAN_DECISION_REQUIRED` 停止到用户侧。
10. 通过后 Frontend/Backend 严格按设计文档和原子任务实现。
11. 每个原子任务必须先自测，再进入下一步。
12. Test Agent 测试，遇到问题汇总给 Brain Agent，Brain Agent 分派给责任 Agent，直到全部解决。
13. Test Agent 输出测试报告，Product Agent 验收。
14. 用户验收，验收通过后归档。

## 状态字段

`agent-loop-docs/process/workflow-state.md` 控制当前流程：

- `PRD 路径`：当前执行哪份 PRD。
- `项目类型`：`existing_refactor` 或 `new_project`。
- `PRD 修改模式`：`review_only` 或 `direct_edit`。
- `当前阶段`：当前 phase。
- `Gate 状态`：`DRAFT` / `CHANGES_REQUESTED` / `RECHECK_REQUIRED` / `BLOCKED`。

事实来源分工：

```text
运行中状态：.agent-runs/current-run.json / current-tasks.json / current-events.jsonl / /jobs
阶段推进状态：agent-loop-docs/process/workflow-state.md / /status
当前问题事实：agent-loop-docs/gate-results/*.json
流程快照：agent-loop-docs/process/agent-loop-dashboard.md
```

## 默认窗口与模型

- 默认窗口 runner：`warp`
- 默认 Agent engine：`opencode`
- 备用 runner：`tmux`
- 备用 engine：`codex`

## 代码集成

实现阶段通过 Gate 后，会先维护 `agent/integration/<feature>` integration branch 和 `.agent-worktrees/integration-<feature>`。如果 integration branch merge 出现 conflict，Gate 会转为 `HUMAN_DECISION_REQUIRED`，不会推进 workflow-state，也不会把代码复制回主工作树。

integration branch 无冲突后，当前短期仍会复制已通过的 `client/` / `server/` 改动回主工作树，供测试和验收阶段预加载。后续可从 integration branch 发展更严格的集成/PR 流程。

## 验收

```bash
npm run agent -- doctor
find scripts/agent-loop -name '*.mjs' -print0 | xargs -0 -n1 node --check
npm run agent -- next --preview
npm run agent -- jobs
npm run agent -- logs
```

## 安全边界

1. Brain Agent 不写业务代码。
2. 文档阶段默认不改 `client/` 或 `server/`。
3. PRD 默认 `review_only`，不直接改 PRD。
4. 结构/格式类修复通过后可以跳过额外复查；业务、架构、实现、测试类修复后必须复查。
5. 连续失败 3 次进入 `BLOCKED`，必须由你和 Brain Agent 确认。
6. 实现阶段必须按设计文档和原子任务执行。
7. 每个原子任务必须自测。
8. 缺少 `gate_result.json` 或结构化结论不是 PASS，Gate 不得通过。
