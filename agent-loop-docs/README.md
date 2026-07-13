# Agent Loop Docs

这是 bossResume 终端全自动 Agent Loop 的唯一文档根目录。

`docs/` 继续保留产品 PRD、业务、架构、数据库和历史文档；当前 Agent Loop 的流程状态、运行看板、Gate Result、Issue、Review、技术方案、测试报告、验收和归档都放在 `agent-loop-docs/`，避免和旧文档混在一起。

## 目录结构

| 目录 | 放什么 |
|---|---|
| `agent-loop-docs/process/` | 当前流程协议、workflow-state、completion-status、dashboard、confirmed-decisions、Agent 注册表、Gate 矩阵、PRD Review 标准、Brain 对话记录说明 |
| `agent-loop-docs/prd-addendums/` | 从业务 PRD 目录迁出的 Agent Loop 流程补充说明 |
| `agent-loop-docs/reviews/` | Product/FE/BE/Test/UI Review、架构影响评审、设计评审 |
| `agent-loop-docs/tech/` | UI 设计、前端设计、后端设计、测试设计、架构设计 |
| `agent-loop-docs/gate-results/` | 每个 Agent 输出的结构化 `gate_result.json`，是当前问题和用户决策的事实来源 |
| `agent-loop-docs/decisions/` | Brain Orchestrator 的 Gate 决策记录 |
| `agent-loop-docs/issues/` | Gate 不通过后生成的结构化 issue 和修复回流记录，包含 `issue_signature` 和 `repeat_count` |
| `agent-loop-docs/test-reports/` | 自测、测试、回归和修复报告 |
| `agent-loop-docs/acceptance/` | 产品验收和用户验收 |
| `agent-loop-docs/archive/` | 用户验收通过后的整轮归档和历史 Agent Loop 文档 |
| `agent-loop-docs/archive/history/` | 已迁移的历史入口、历史报告和旧清理记录 |

## 当前入口

- 当前流程状态：`agent-loop-docs/process/workflow-state.md`
- 完成状态记录：`agent-loop-docs/process/completion-status.md`
- 最近运行看板：`agent-loop-docs/process/agent-loop-dashboard.md`
- 已确认决策：`agent-loop-docs/process/confirmed-decisions.json`
- Brain Loop 协议：`agent-loop-docs/process/brain-loop-protocol.md`
- Gate 矩阵：`agent-loop-docs/process/gate-matrix.md`
- Agent 注册表：`agent-loop-docs/process/agent-registry.md`
- PRD Review 标准：`agent-loop-docs/process/prd-review-standard.md`
- Agent 文档标准：`agent-loop-docs/process/agent-doc-standard.md`
- Agent Prompt 索引：`agent-loop-docs/process/codex-agent-prompts.md`
- Brain 常驻对话运行产物：`agent-loop-docs/process/brain-conversation.jsonl`，该文件已加入 `.gitignore`，不作为正式文档提交。

## 运行态事实来源

运行中状态不看 dashboard，而看：

```text
.agent-runs/current-run.json
.agent-runs/current-tasks.json
.agent-runs/current-events.jsonl
```

用户命令：

```bash
npm run agent -- jobs
npm run agent -- logs
npm run agent -- logs raw
```

## PRD 位置

正式 PRD 仍在 `docs/prd/`，例如：

```bash
docs/prd/bossresume-full-refactor-prd.md
```

Agent Loop 流程补充说明放在：

```bash
agent-loop-docs/prd-addendums/bossresume-full-refactor-prd-v1.2-agent-workflow-addendum.md
```

## 用户日常命令

```bash
npm run agent -- start docs/prd/bossresume-full-refactor-prd.md
npm run agent -- chat
npm run agent -- status
npm run agent -- jobs
npm run agent -- logs
npm run agent -- next --preview
npm run agent -- next
npm run agent -- next --foreground
npm run agent -- next --mode=single
npm run agent -- next --mode=auto --max-loops=10
npm run agent -- doctor
```

`npm run agent -- chat` 默认打开常驻 Brain Agent 对话框。普通文字会发送给主 Agent 讨论；`/status`、`/jobs`、`/watch`、`/logs`、`/preview`、`/next`、`/doctor`、`/history`、`/exit` 是对话框内部命令。

底层命令 `agent:brain`、`agent:state`、`agent:loop`、`agent:loop:dry-run`、`agent:loop:verify` 仍然保留，但只作为调试和维护入口。
