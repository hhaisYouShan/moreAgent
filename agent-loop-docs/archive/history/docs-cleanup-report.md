# 文档与 Agent 清理报告

## 1. 当前清理结论

本轮将终端全自动 Agent Loop 的当前运行态和产物从 `docs/` 分离出来，统一迁移到仓库根目录的 `agent-loop-docs/`。

`docs/` 现在保留产品 PRD、项目级架构/数据库、历史流程说明和历史 Review；当前自动流程以 `agent-loop-docs/` 为唯一入口。

## 2. 本轮新增或更新

| 文件/目录 | 处理 | 原因 |
|---|---|---|
| `agent-loop-docs/README.md` | 新增 | Agent Loop 文档总入口 |
| `agent-loop-docs/process/` | 新增 | 当前 workflow-state、completion-status、dashboard、协议、Gate 矩阵、Agent 注册表、PRD Review 标准 |
| `AGENTS.md` | 更新 | 指向 `agent-loop-docs/`，明确 `docs/` 不维护重复运行态 |
| `docs/README.md` | 更新 | 将 `docs/` 与 `agent-loop-docs/` 职责分离 |
| `agent-loop-docs/prd-addendums/bossresume-full-refactor-prd-v1.2-agent-workflow-addendum.md` | 更新 | PRD 补充说明改为当前 Agent Loop 路径 |
| `agent-loop-docs/archive/history/codex-agent-workflow.md` | 更新 | 历史入口说明指向当前 `agent-loop-docs/` |
| `agent-loop-docs/process/codex-agent-prompts.md` | 更新 | 提示词索引指向当前 Agent Loop 文档和 prompt |
| `agent-loop-docs/archive/history/agent-brain-workflow.md` | 更新 | 标记为历史参考，当前入口指向 `agent-loop-docs/` |
| `agent-loop-docs/process/agent-doc-standard.md` | 更新 | 文档规范里的输出路径改为 `agent-loop-docs/` |
| `scripts/agent-loop/*.mjs` | 更新 | workflow-state、Gate Result、Issue、Decision、Review、Tech、Test、Acceptance、Archive 输出改到 `agent-loop-docs/` |
| `scripts/agent-loop/agents/*.md` | 更新 | PRD Review 标准路径改为 `agent-loop-docs/process/prd-review-standard.md` |

## 3. 本轮删除的重复文件

以下旧运行态文件已从 docs 目录删除，替代文件位于 `agent-loop-docs/process/`：

| 删除文件 | 替代文件 |
|---|---|
| workflow-state | `agent-loop-docs/process/workflow-state.md` |
| completion-status | `agent-loop-docs/process/completion-status.md` |
| brain-loop-protocol | `agent-loop-docs/process/brain-loop-protocol.md` |
| gate-matrix | `agent-loop-docs/process/gate-matrix.md` |
| agent-registry | `agent-loop-docs/process/agent-registry.md` |
| prd-review-standard | `agent-loop-docs/process/prd-review-standard.md` |
| brain-discussion | `agent-loop-docs/process/brain-discussion.md` |
| agent-loop-dashboard | `agent-loop-docs/process/agent-loop-dashboard.md` |

## 4. 保留文件说明

| 文件 | 保留原因 |
|---|---|
| `agent-loop-docs/archive/history/agent-brain-workflow.md` | 历史流程参考，不是当前运行态副本 |
| `agent-loop-docs/process/agent-doc-standard.md` | 文档规范参考，已更新为新路径 |
| `agent-loop-docs/archive/history/multi-agent-workflow-verification-report.md` | 历史验证报告，已标注不作为当前入口 |
| `agent-loop-docs/archive/history/docs-cleanup-report.md` | 清理记录本身，继续保留 |

## 5. 验证建议

在本地 bossResume 根目录执行：

```bash
npm run agent:loop:verify -- --prd=docs/prd/bossresume-full-refactor-prd.md
npm run agent:loop:dry-run
```

通过后再执行真实 loop：

```bash
npm run agent:loop
```
