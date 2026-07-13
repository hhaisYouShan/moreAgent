# Agent Loop Dashboard

这个文件由 Brain Orchestrator 在真实 `agent:loop` 运行后自动更新，用来快速查看当前流程走到哪里。

## 当前状态

- feature-key：`bossresume-full-refactor`
- PRD：`docs/prd/bossresume-full-refactor-prd.md`
- phase：`INTAKE`
- gateStatus：`DRAFT`
- failureCount：`0`

## 推荐命令

```bash
npm run agent:brain -- --prd=docs/prd/bossresume-full-refactor-prd.md
npm run agent:loop:verify -- --prd=docs/prd/bossresume-full-refactor-prd.md
npm run agent:loop:dry-run
npm run agent:loop
```

## Self Check

结论：PASS
是否允许进入下一阶段：是
