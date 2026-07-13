# 术语表

```yaml
status: active
version: 0.2
owner: documentation
last_updated: 2026-07-12
```

| 术语 | 定义 |
|---|---|
| AI Software Company OS | 以确定性控制平面管理多 Agent 软件交付的操作系统 |
| Workflow | 一个 Feature 从初始化到归档的完整交付流程 |
| Phase | Workflow 内的阶段，如 PRD Review、Implementation、Testing |
| Gate | 决定阶段是否可推进的结构化准入结果 |
| Task | 可调度、可锁定、可验证的原子工作单元 |
| Workstream | Initial、Repair、Recheck 复用责任人、Session 和 Workspace 的连续工作单元 |
| Run | 一个 Task 的一次实际执行尝试 |
| Session | Agent 会话及其上下文生命周期 |
| Window | Warp/tmux 等执行窗口，仅是视图，不是事实源 |
| Workspace | Agent 实际操作的隔离工作空间 |
| Worktree | 基于 Git Branch 的轻量 Workspace |
| Container | 提供进程、资源、网络和 Secret 隔离的 Sandbox |
| Artifact | 被注册、版本化、校验并可被下游消费的正式产物 |
| Artifact Registry | 管理 Artifact 元数据、状态、版本、Hash 和替代关系的服务 |
| Issue | 需要分派、修复、复核或决策的问题实体 |
| Decision | 经用户或授权 Gate 确认的不可变决定 |
| Context Manifest | 当前 Task 所需文件、Artifact、Decision、Hash、Token 和权限清单 |
| Project Map | 表达模块、文件、API、表、路由、组件、权限和测试关系的项目地图 |
| Traceability Matrix | Requirement 到 Design、Task、Code、Test、Acceptance、Release 的关系矩阵 |
| Working Memory | 当前 Task/Workstream 使用的短期上下文 |
| Long-term Memory | 经 Gate 认可并可跨 Session/项目复用的长期知识 |
| Shared Memory | 多 Agent 受控共享的 Decision、Project Map、Artifact、Issue 等信息 |
| RAG | 基于检索增强生成的知识获取机制，不是事实源本身 |
| Prompt Registry | 管理 Prompt ID、版本、状态、绑定、测试和回滚的服务 |
| Model Router | 根据任务、风险、成本、合规和 Provider 状态选择模型的组件 |
| Adapter | 核心接口的可替换基础设施实现 |
| Project Profile | 项目特定路径、技术栈、流程、命令和验收配置 |
| Capability Pack | 针对技术栈或任务类型的检测器、规则、命令、Prompt 和测试集合 |
| executionKey | projectId + taskId + inputHash + executionMode，用于执行幂等 |
| Input Hash | 当前 Task 所有关键输入和环境形成的 Hash |
| Lease | 有过期时间的任务或资源占用权 |
| Heartbeat | 证明 Agent/Run 仍存活的周期信号 |
| Recheck | 原 Reviewer/Test 对修复结果的再次验证 |
| Reverify | 对已有 Artifact 和 State 一致性的确认，不增加业务 Round |
| Repair | 针对明确 Issue 的定向修复 |
| Failure Attribution | 基于证据识别失败类型、Primary Owner 和置信度的过程 |
| Side-effect Ledger | 记录外部不可逆或非幂等副作用的审计账本 |
| Auto Capability Gate | 决定某类 Workflow 是否允许自动运行的统一授权机制 |
| RPO | 可接受的数据丢失时间窗口 |
| RTO | 故障后恢复服务的目标时间 |
