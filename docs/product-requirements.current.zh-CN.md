# MoreAgent 当前版产品需求文档

## 一、文档目的

这份文档不是早期愿景版 PRD 的重复整理，而是对 MoreAgent 当前真实产品状态的重新定义。

它的目标是回答四个问题：

1. 最初想做什么
2. 现在已经做到了什么
3. 现在还没做到什么
4. 接下来 V3.1 到 V5.0 应该怎么演进

本文件优先描述“当前真实产品目标”和“当前真实能力边界”，避免继续把早期规划、当前实现、未来路线混在一起。

## 二、当前产品定位

### 2.1 一句话定位

MoreAgent 是一个面向本地代码仓库的多 Agent 开发编排工具，用文件化状态、独立 artifact、task worktree 和可追踪 run，把一个开发任务组织成可审查、可恢复、可合并的 AI 开发流水线。

### 2.2 当前定位边界

当前 MoreAgent 不是：

1. 远程 AI 开发平台
2. 团队协作系统
3. 自动发布系统
4. 自动 merge / 自动 push 工具
5. 需要数据库的复杂服务

当前 MoreAgent 是：

1. 本地 CLI 优先的项目级编排层
2. 面向单仓库开发流程的多 Agent 工具
3. 在 OpenCode CLI 之上增加 run / workflow / artifact / worktree / review / merge 边界的产品
4. 一个已经具备 MVP pipeline、full workflow、report、dashboard、serve/watch 的本地开发系统

## 三、当前核心用户

### 3.1 当前最核心用户

1. 重度使用 AI 编程工具的个人开发者
2. 希望把 AI 开发过程“流程化”的前后端工程师
3. 希望把任务拆成 plan -> implement -> test -> review 的技术负责人
4. 需要保留 artifact、日志、状态和 merge 边界的本地代码仓库维护者

### 3.2 当前不重点服务的用户

1. 需要多人协同登录的团队平台用户
2. 需要远程托管控制台的用户
3. 需要 GitHub / 云端审批流闭环的企业用户
4. 只想把 AI 当作单次聊天问答工具的用户

## 四、原始 PRD 与当前产品现实

## 4.1 原始 PRD 中已完成的能力

基于 [product-requirements.zh-CN.md](product-requirements.zh-CN.md)，以下能力已经完成或基本完成：

### 初始化与基础设施

1. `moreagent init`
2. `.moreagent/` 目录初始化
3. `.opencode/agents/` 初始化
4. 文件化状态管理
5. `.moreagent/config.yaml`
6. `.moreagent/sessions.json`
7. `.moreagent/runs/`
8. `.moreagent/worktrees/`

### MVP 单任务流水线

1. `moreagent start --once --task "xxx"`
2. `moreagent start --once --task "xxx" --agent <name>`
3. 顺序执行 Agent
4. 保存 Agent artifact
5. 保存 stdout / stderr
6. task worktree 隔离代码修改
7. Agent 失败后停止后续流程

### 中期演进中已完成的能力

1. `moreagent status`
2. `moreagent clean`
3. repair loop
4. failure attribution
5. resume
6. OpenCode runtime session mapping
7. reviewer / tester 的 artifact decision 协议
8. dashboard
9. report

## 4.2 原始 PRD 中未完成的能力

以下内容仍属于未完成或未进入当前实现主线：

### 原始中长期目标未完成项

1. 多项目管理
2. 团队级权限控制
3. 审计日志体系化平台化
4. GitHub Issue / PR 深度集成闭环
5. Codex / Claude Code 的真实运行时适配落地
6. Agent 模板市场
7. workflow 模板市场
8. 团队审批流

### 原始愿景中的平台化未完成项

1. 远程 Web 平台
2. 登录系统
3. 多用户管理
4. 云端部署
5. 自动发布 / ship 自动化

## 4.3 已经超出原始 PRD 的能力

当前产品已经明显超出早期 PRD 里“先稳定单任务 MVP”的阶段，主要超出点包括：

### 超出 MVP 范围的工作流能力

1. full workflow 9-phase 流程
2. PRD Gate / Tech Gate
3. failure-analysis 与 owner 定向修复
4. resume latest / resume run / from-phase
5. queue add / list / retry / recover
6. `start --loop`

### 超出早期 CLI 能力的可视化与报告能力

1. `report`
2. `status --json`
3. `inspect --json`
4. static dashboard
5. `dashboard --open`
6. `dashboard --serve`
7. `dashboard --serve --watch`

### 超出原始“单任务流水线”设想的运行时能力

1. OpenCode runtime session registry
2. merge dry-run / apply
3. diff / inspect / report / dashboard 多种查看面
4. serve/watch 模式下本地 HTTP 可视化

## 五、当前真实产品能力总览

### 5.1 当前已具备的核心能力

#### 运行与编排

1. MVP 4-agent pipeline
2. full workflow 9-phase pipeline
3. single-run 执行
4. queue loop 执行
5. phase resume
6. failure repair

#### 状态与产物

1. sessions.json
2. runtime-sessions.json
3. artifact directories
4. stdout / stderr
5. machine-readable report decisions
6. machine-readable test/review decisions

#### 查看与验收

1. `status`
2. `inspect`
3. `report`
4. `diff`
5. static dashboard
6. serve/watch dashboard
7. merge readiness

#### 代码隔离与合并边界

1. one run one task worktree
2. code change isolation
3. human-controlled merge
4. dirty main / missing worktree / blocked merge checks

### 5.2 当前产品最重要的价值

当前阶段，MoreAgent 最核心的产品价值不是“自动替你完成所有开发”，而是：

1. 把 AI 开发过程结构化
2. 把代码改动隔离到 worktree
3. 把产物、状态、失败原因和 merge 边界记录下来
4. 让用户可以从“直接和一个 AI 聊”升级为“管理一个可追踪的 AI 开发流程”

## 六、当前核心流程

## 6.1 当前 MVP 流程

当前默认 MVP 流程：

```text
architect -> implementer -> tester -> reviewer
```

对应产品流程：

1. 用户提交任务
2. architect 输出方案
3. implementer 在 task worktree 中改代码
4. tester 输出测试结论
5. reviewer 输出审查结论
6. 如测试或审查失败，则进入 repair loop
7. 最终是否 merge 由人工决定

## 6.2 当前 full workflow 流程

当前 full workflow 流程：

```text
brain
-> prd
-> prd-review
-> prd-gate
-> tech-plan
-> tech-gate
-> implementation
-> test
-> review
```

对应产品流程：

1. 用户提交任务
2. brain 统筹流程
3. product / frontend / backend / tester 参与 PRD 或方案阶段
4. gate 判断需求和技术方案是否通过
5. implementation 阶段执行代码改动
6. test / review 决定是否进入 repair
7. failure-analysis 决定回修 owner
8. 人工决定是否 merge

## 6.3 当前验收流程

当前实际验收是三层：

1. 运行层：run 是否完成、session 是否成功
2. 质量层：gate / test / review / repair 是否通过
3. 合并层：main 是否干净、worktree 是否存在、是否允许人工 merge

## 七、与最终多 Agent 流程图的对应关系

用户给出的最终目标流程图，本质上描述的是一个更完整的多 Agent 产品团队式开发流程。

当前 MoreAgent 与该流程图的对应关系如下。

## 7.1 已经有明确对应的部分

### 用户提交任务 -> 总控编排

对应当前能力：

1. `start --once`
2. `start --loop`
3. run / session 编排

### 产品 / 前端 / 后端 / 测试 / Review 角色分工

对应当前能力：

1. MVP pipeline 中已有 architect / implementer / tester / reviewer
2. full workflow 中已有 brain / product / frontend / backend / tester / reviewer

### 评审 / gate / 失败回修

对应当前能力：

1. PRD Gate
2. Tech Gate
3. tester / reviewer decision
4. failure-analysis owner 路由
5. repair loop

### 人工确认 / merge

对应当前能力：

1. merge readiness
2. merge dry-run
3. merge apply
4. 人工最终决定

## 7.2 部分实现、但还不完全等价的部分

### 多 Agent 评审会议

当前有：

1. gate 和 review 的文件化流程

但还没有：

1. 真正意义上的会议式 UI / 协作体验

### 持续开发任务队列

当前有：

1. queue
2. `start --loop`

但还没有：

1. 更平台化的任务运营视图

## 7.3 仍未实现的最终目标部分

1. 团队级控制台
2. 多人协作
3. 远程服务
4. 登录 / 权限 / 审计
5. 多 runtime 产品化适配完成

## 八、当前非目标

当前版本不追求以下目标：

1. 自动替用户 merge / push
2. 远程托管平台
3. 团队级在线协作
4. 自动发布 / ship
5. 浏览器端执行型按钮
6. 数据库化状态中心
7. 复杂的实时推送架构
8. 完整的多 runtime 统一兼容平台

## 九、V3.1 ～ V5.0 路线图

## 9.1 V3.1

主题：

1. Dashboard usability hardening
2. serve/watch 启动信息补强
3. runtime status 与 refresh 状态补强
4. 文档同步和测试补强

目标：

1. 完成 serve/watch 的启动信息、runtime status、`Refresh data`、`Last refreshed`、`Refresh failed`、`Showing last successful data`。
2. 补齐 no-runs watch 场景下的稳定性、文档同步和测试补强。
3. 让 dashboard serve/watch 从“能运行”提升到“可稳定使用、可观察、可排障”。

## 9.2 V3.2

主题：

1. 一键集成项目
2. `moreagent init --full`
3. 完整工作流配置与接入说明生成

目标：

1. `moreagent init --full` 生成完整工作流配置、docs、agents、项目接入说明。
2. 让用户可以把 moreAgent 一键接入已有项目，而不是手工补齐配置和文档。

## 9.3 V4.0

主题：

1. PRD 评审会议
2. 多角色需求评审
3. product 修订与 brain gate 判断

目标：

1. frontend / backend / tester review PRD。
2. product Agent 回答评审问题并修订 PRD。
3. 总大脑判断 PRD 是否通过，未通过则继续修订。

## 9.4 V4.1

主题：

1. 技术方案三方评审
2. frontend-plan / backend-plan / test-plan
3. brain 统一技术评审

目标：

1. 由 frontend / backend / tester 分别产出技术方案。
2. 总大脑统一评审技术方案，决定通过或退回修改。

## 9.5 V4.2

主题：

1. 失败归因和定向回流
2. test / review 失败后的 owner 分派
3. 按角色回修闭环

目标：

1. 测试失败或 review 失败后，总大脑分析归因。
2. 将问题定向派回 frontend / backend / tester / product 对应角色修复。
3. 修复后重新进入测试和评审闭环。

## 9.6 V5.0

主题：

1. 真正多 Agent 并行 worktree 执行
2. 并行开发、测试、review
3. 总大脑统一调度和收敛

目标：

1. 多个 Agent 在独立 worktree 中并行开发、测试、review。
2. 由总大脑统一调度并行执行结果并完成收敛。
3. 保持 session、artifact、workflow 的统一可观测性。

## 十、原始 PRD 与后续版本验收标准

## 10.1 当前版产品验收标准

当前版本至少应满足：

1. 用户能初始化项目
2. 用户能跑 MVP pipeline
3. 用户能跑 full workflow
4. 用户能看到 artifact、sessions、report、dashboard
5. 用户能在失败后 repair / resume
6. 用户能在 worktree 中隔离代码改动
7. 用户能在人工确认后 merge

## 10.2 V3.1 验收标准

1. serve startup output 清晰
2. watch runtime status 清晰
3. refresh failed 后保留 last successful data
4. no runs 不误判为 refresh error
5. selected run persist 不回退
6. static dashboard / `--open` 不回退

## 10.3 V3.2 验收标准

1. `moreagent init --full` 能生成完整工作流所需的 config、docs、agents、目录结构
2. 初始化结果包含项目接入说明，而不是只生成空骨架
3. 用户能在已有仓库中按生成结果完成 moreAgent 接入

## 10.4 V4.0 验收标准

1. PRD 阶段存在 frontend / backend / tester 三个评审角色输出
2. product Agent 能回答问题并修订 PRD
3. 总大脑能判断 PRD 是否通过，并支持未通过时继续修订

## 10.5 V4.1 验收标准

1. `frontend-plan`、`backend-plan`、`test-plan` 三类方案产物能够稳定生成
2. 总大脑能对三方技术方案统一评审并输出 gate 结论
3. 技术方案未通过时，能够回退到对应方案修订阶段

## 10.6 V4.2 验收标准

1. tester 或 reviewer 失败后，会生成明确的失败归因结果
2. 归因结果能够把修复任务定向派回 frontend / backend / tester / product 对应角色
3. 定向修复后，流程能重新回到 test / review 并继续收敛

## 10.7 V5.0 验收标准

1. 多个 Agent 能在独立 worktree 中并行执行，而不是共享单一任务 worktree
2. 总大脑能统一调度并行执行结果，并完成测试、评审与阶段收敛
3. 并行 worktree 的 session、artifact、status、report、dashboard 仍能保持统一可观测性

## 十一、当前版本结论

当前 MoreAgent 已经不是“只会顺序跑 4 个 Agent 的空骨架”，也还不是“完整团队级 AI 开发平台”。

它当前最准确的产品阶段是：

1. 已完成本地单仓库多 Agent 编排闭环
2. 已具备验收、查看、repair、resume、merge 边界
3. 正在从“可跑”走向“好用、稳定、可观察”

因此当前最合理的产品目标不是继续泛化愿景，而是：

1. 把现有 V3.x 使用体验做扎实
2. 把 runtime、workflow、artifact、dashboard 语义统一
3. 为后续 V4.x 的多角色评审、归因回流和并行执行打基础
