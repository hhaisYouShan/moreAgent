#!/usr/bin/env node

import { cleanCommand } from './commands/clean';
import { initCommand } from './commands/init';
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
  status                    Show recent run status
  clean                     Clean runs or worktrees

Start Options:
  --once                    Run all agents once (required for MVP)
  --task <description>      The task to execute
  --agent <name>            Run a specific agent only (optional)

Status Options:
  --latest                  Show the latest run in detail

Clean Options:
  --runs                    Clean .moreagent/runs and reset sessions.json
  --worktrees               Clean .moreagent/worktrees
  --all                     Clean both runs and worktrees

Examples:
  moreagent init
  moreagent start --once --task "add user authentication"
  moreagent start --once --task "refactor database layer" --agent implementer
  moreagent status
  moreagent status --latest
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
        if (!args.includes('--once')) {
          console.error('Error: --once flag is required for start command');
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

      case 'status':
        statusCommand({ latest: args.includes('--latest') });
        break;

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
