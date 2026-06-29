# MoreAgent 任务规划

## 目标

MoreAgent 最终要做成一个项目级 AI 开发编排器：

```txt
用户提交任务
-> 总大脑 Agent 分析和拆分
-> 产品 / 前端 / 后端 / 测试 / Review 多 Agent 协作
-> 所有过程有 session、artifact、日志、worktree 和状态记录
-> 最终由人工确认是否合并
```

当前重点不是直接做平台版，而是先把单任务 MVP 稳定跑通。后续所有复杂能力都依赖这个基础。

## 当前阶段判断

```txt
设计文档阶段          已完成
项目骨架阶段          已完成
单任务执行 MVP        已完成雏形，但尚未成功端到端试跑
多 Session 稳定管理   未完成
多终端可观察          未完成
持续自动开发          未完成
平台化                未完成
```

当前最大阻塞：

- 本机 `opencode` 不在 PATH，真实 Agent 执行无法成功。
- `start` 失败前没有 runtime command 预检。
- `sessions.json` 已经出现 stale running run。
- reviewer 还没有强制进入 task worktree 审查。
- worktree 创建失败时当前实现会 fallback 到当前目录，不安全。

## Phase 1：稳定单任务 MVP

目标：

让一个最小任务可以稳定完成：

```bash
moreagent start --once --task "给 README 增加 Usage 示例"
```

验收标准：

- `moreagent init` 创建完整项目状态。
- OpenCode 可以识别 `.opencode/agents/*.md`。
- 单 Agent 可以成功运行。
- 完整四 Agent pipeline 可以成功运行。
- 代码改动只出现在 task worktree。
- 失败时 run / session 状态准确。

任务：

1. `init` 自动生成 `.opencode/agents/*.md`
2. `start` 前检查 `runtime.opencodePath` 是否存在
3. OpenCode 不存在时给出明确错误，不创建误导性的 running session
4. 实时打印 stdout / stderr
5. 暂时移除或确认 `--session` 参数用法
6. reviewer 在存在 task worktree 时进入 worktree 审查
7. worktree 创建失败时直接失败，不 fallback 到当前目录
8. 增加 artifact 校验：主产物仍是模板时用 stdout 兜底
9. 增加 stale running run 标记或清理能力
10. 用一个 README 小任务完成端到端试跑

## Phase 2：状态查看和调试能力

目标：

用户可以知道 MoreAgent 现在做到了哪一步、卡在哪里、产物在哪里。

验收标准：

- 可以查看最近 runs。
- 可以查看每个 Agent 的状态、耗时、错误和 artifact 路径。
- 可以识别 failed / running / stale。
- 可以快速定位 worktree。

任务：

1. 新增 `moreagent status`
2. 输出最近 N 个 run
3. 输出每个 session 的状态、耗时、错误
4. 输出 artifactDir 和 worktreePath
5. 检测 stale running run
6. 新增 `moreagent clean --stale`
7. 新增 `moreagent clean --runs`
8. 新增 `moreagent clean --worktrees`
9. 给失败原因做简单分类：runtime missing、agent failed、timeout、worktree failed

## Phase 3：运行时抽象

目标：

MoreAgent 不再写死 OpenCode，为后续 Codex / Claude Code 做准备。

验收标准：

- OpenCode 只是一个 runtime profile。
- Agent 可以选择 runtime。
- runtime 缺失时能预检失败。
- 不同 runtime 的命令参数集中维护。

任务：

1. 定义 `RuntimeAdapter` 接口
2. 将 `OpenCodeRuntimeAdapter` 移到 runtime profile 模型下
3. 配置从 `runtime.opencodePath` 演进到 `runtimes`
4. 保持向后兼容旧配置
5. 增加 runtime command preflight
6. 增加 runtime-specific state detector
7. 预留 Codex adapter
8. 预留 Claude Code adapter

## Phase 4：Agent 模板和 Workflow 模板

目标：

把 prompt 从配置字符串升级为可维护的产品资产。

验收标准：

- Agent prompt 可以放在 `.moreagent/agents/*.md`
- `.moreagent/config.yaml` 只负责编排和引用
- 可以同步生成 `.opencode/agents/*.md`
- 可以选择不同 workflow

任务：

1. 新增 `.moreagent/agents/architect.md`
2. 新增 `.moreagent/agents/implementer.md`
3. 新增 `.moreagent/agents/tester.md`
4. 新增 `.moreagent/agents/reviewer.md`
5. 新增 `moreagent sync-agents`
6. 检测 `.moreagent/config.yaml` 与 `.opencode/agents/*.md` 是否漂移
7. 内置 `default` workflow
8. 内置 `review-only` workflow
9. 内置 `qa-only` workflow
10. 给 Agent prompt 加版本字段

## Phase 5：失败修复循环

目标：

测试失败或 Review 不通过后，MoreAgent 能根据归因回到正确 Agent。

验收标准：

- tester 输出结构化失败报告。
- reviewer 输出结构化 review report。
- 总控逻辑可以判断问题归属。
- 最多修复 N 轮，避免无限循环。

任务：

1. 规范 `test-report.md` 的失败归因字段
2. 规范 `review-report.md` 的阻塞问题字段
3. 增加失败归因枚举：frontend、backend、test、requirement、unknown
4. MVP 阶段先映射到 implementer / tester / architect
5. Review 不通过时回到 implementer
6. 测试用例问题回到 tester
7. 需求或方案问题回到 architect
8. 增加 `maxRepairRounds`
9. 每一轮修复都写入 run timeline

## Phase 6：多终端可观察

目标：

用户可以看到每个 Agent 的独立执行窗口，而不是只看最终日志。

验收标准：

- 每个 Agent 有独立终端视图。
- 可以回到菜单查看所有 Agent 状态。
- 用户能看到 waiting / running / failed / completed。

任务：

1. 先实现实时日志 streaming
2. 评估 tmux 模式
3. 评估内置 TUI 模式
4. 每个 Agent 一个 pane / session
5. 增加状态轮询
6. 增加等待用户输入提示
7. 增加终端返回主菜单快捷键

## Phase 7：持续任务队列

目标：

MoreAgent 可以持续消费任务队列，但每个任务完成后仍由人工确认。

验收标准：

- 可以从 `.moreagent/task-queue.md` 读取任务。
- 每次只处理一个任务。
- 每个任务都有独立 run 和 worktree。
- 完成后等待人工确认再继续。

任务：

1. 新增 `.moreagent/task-queue.md`
2. 新增 `moreagent start --loop`
3. 支持 `maxTasks`
4. 支持 `stopOnFailure`
5. 每个任务完成后输出确认提示
6. 人工确认后才进入下一个任务
7. 不自动 merge
8. 不自动 push

## Phase 8：平台级多 Agent 协作

目标：

实现最终平台版流程：

```txt
用户提交任务
-> 总大脑分析
-> 产品 Agent 生成 PRD
-> 前端 / 后端 / 测试 Agent 评审 PRD
-> 产品 Agent 修订
-> 总大脑判断是否通过
-> 总大脑拆分任务
-> 前端 / 后端 / 测试分别设计方案
-> 总大脑评审技术方案
-> 前端 / 后端开发
-> 测试执行
-> Review 审查
-> 人工确认合并
```

验收标准：

- 支持多角色 review meeting。
- 支持 PRD 修订循环。
- 支持技术方案评审循环。
- 支持测试失败归因。
- 支持 Review 问题归因。
- 支持按归属回流到前端、后端、测试或产品。

任务：

1. 新增 brain Agent
2. 新增 product Agent
3. 新增 frontend Agent
4. 新增 backend Agent
5. 扩展 tester Agent
6. 扩展 reviewer Agent
7. 新增 PRD artifact：`prd.md`
8. 新增 review meeting artifact：`prd-review.md`
9. 新增 frontend plan：`frontend-plan.md`
10. 新增 backend plan：`backend-plan.md`
11. 新增 test plan：`test-plan.md`
12. 新增 technical review：`technical-review.md`
13. 新增 failure attribution：`failure-attribution.md`
14. 新增 workflow DSL 或 workflow yaml
15. 支持条件分支和循环
16. 支持人工审批节点

## 建议执行顺序

当前不要直接做 Phase 8。

最合理的执行顺序：

1. 先完成 Phase 1，让单任务真实跑通。
2. 再完成 Phase 2，让状态和失败原因可见。
3. 再完成 Phase 3，把 runtime 抽象稳定。
4. 再完成 Phase 4，把 Agent 和 workflow 模板化。
5. 然后做 Phase 5 的失败修复循环。
6. 再做 Phase 6 的多终端可观察。
7. 最后做 Phase 7 / Phase 8。

判断标准：

如果一个能力不能帮助“单任务稳定完成并可追踪”，就不应该进入当前开发阶段。

