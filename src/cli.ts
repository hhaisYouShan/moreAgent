#!/usr/bin/env node

import { cleanCommand } from './commands/clean';
import { diffCommand } from './commands/diff';
import { initCommand } from './commands/init';
import { inspectCommand } from './commands/inspect';
import { queueAddCommand, queueListCommand, queueRecoverCommand, queueRetryCommand } from './commands/queue';
import { statusCommand } from './commands/status';
import { startCommand } from './commands/start';

function printHelp(): void {
  console.log(`
MoreAgent — Multi-agent orchestration tool for OpenCode CLI

Usage:
  moreagent <command> [options]

Commands:
  init                      Initialize a new MoreAgent project
  start --once --task <...> Run a task through the agent pipeline
  start --loop              Process all pending tasks in the queue
  queue add --task <...>    Add a task to the queue
  queue list                List all tasks in the queue
  status                    Show recent run status
  status --latest           Show the latest run in detail
  diff                      Show worktree git diff for the latest run
  diff --run <id>           Show worktree git diff for a specific run
  inspect                   Show latest run overview
  inspect --agent <name>    Show an agent's primary artifact
  inspect --run <id>        Show a specific run
  clean                     Clean runs or worktrees

Start Options:
  --once                    Run a single task (requires --task)
  --task <description>      The task to execute (required for --once)
  --agent <name>            Run a specific agent only (optional)
  --loop                    Process all pending tasks from the queue

Queue Options:
  queue add --task <desc>   Add a new task to the pending queue
  queue list                Show tasks (latest 20)
  queue list --all          Show all tasks
  queue recover             Mark interrupted running tasks as failed
  queue retry --task <id>   Create a new pending task from a failed one

Examples:
  moreagent init
  moreagent start --once --task "add user authentication"
  moreagent start --once --task "refactor database layer" --agent implementer
  moreagent start --loop
  moreagent queue add --task "update README usage section"
  moreagent queue list
  moreagent status
  moreagent status --latest
  moreagent diff
  moreagent diff --run run-2026-06-29T12-00-00-abc123
  moreagent inspect
  moreagent inspect --agent reviewer
  moreagent clean --runs
  moreagent clean --worktrees
  moreagent clean --all
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const command = args[0];

  try {
    switch (command) {
      case 'init':
        initCommand();
        break;

      case 'start': {
        if (args.includes('--loop')) {
          await startCommand({ once: true, task: '', loop: true });
          break;
        }

        if (!args.includes('--once')) {
          console.error('Error: use --once or --loop with start command');
          process.exit(1);
        }

        const taskIdx = args.indexOf('--task');
        if (taskIdx === -1 || !args[taskIdx + 1]) {
          console.error('Error: --task <description> is required');
          process.exit(1);
        }
        const task = args[taskIdx + 1];

        const agentIdx = args.indexOf('--agent');
        const agent = agentIdx !== -1 ? args[agentIdx + 1] : undefined;

        await startCommand({ once: true, task, agent });
        break;
      }

      case 'queue': {
        const sub = args[1];
        if (sub === 'add') {
          const qTaskIdx = args.indexOf('--task');
          if (qTaskIdx === -1 || !args[qTaskIdx + 1]) {
            console.error('Error: --task <description> is required for queue add');
            process.exit(1);
          }
          queueAddCommand({ task: args[qTaskIdx + 1] });
        } else if (sub === 'list') {
          queueListCommand({ all: args.includes('--all') });
        } else if (sub === 'recover') {
          queueRecoverCommand();
        } else if (sub === 'retry') {
          const retryIdx = args.indexOf('--task');
          if (retryIdx === -1 || !args[retryIdx + 1]) {
            console.error('Error: --task <taskId> is required for queue retry');
            process.exit(1);
          }
          queueRetryCommand({ task: args[retryIdx + 1] });
        } else {
          console.error('Usage: moreagent queue <add|list|recover|retry>');
          process.exit(1);
        }
        break;
      }

      case 'status':
        statusCommand({ latest: args.includes('--latest') });
        break;

      case 'diff': {
        const diffRunIdx = args.indexOf('--run');
        const diffRunId =
          diffRunIdx !== -1 ? args[diffRunIdx + 1] : undefined;
        diffCommand({ run: diffRunId });
        break;
      }

      case 'inspect': {
        const inspectRunIdx = args.indexOf('--run');
        const inspectRunId =
          inspectRunIdx !== -1 ? args[inspectRunIdx + 1] : undefined;
        const inspectAgentIdx = args.indexOf('--agent');
        const inspectAgent =
          inspectAgentIdx !== -1 ? args[inspectAgentIdx + 1] : undefined;
        inspectCommand({ run: inspectRunId, agent: inspectAgent });
        break;
      }

      case 'clean': {
        const cleanRuns = args.includes('--runs') || args.includes('--all');
        const cleanWorktrees =
          args.includes('--worktrees') || args.includes('--all');
        cleanCommand({ cleanRuns, cleanWorktrees });
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
