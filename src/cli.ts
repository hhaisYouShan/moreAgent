#!/usr/bin/env node

import { initCommand } from './commands/init';
import { startCommand } from './commands/start';

function printHelp(): void {
  console.log(`
MoreAgent — Multi-agent orchestration tool for OpenCode CLI

Usage:
  moreagent <command> [options]

Commands:
  init                      Initialize a new MoreAgent project
  start --once --task <...> Run a task through the agent pipeline

Start Options:
  --once                    Run all agents once (required for MVP)
  --task <description>      The task to execute
  --agent <name>            Run a specific agent only (optional)

Examples:
  moreagent init
  moreagent start --once --task "add user authentication"
  moreagent start --once --task "refactor database layer" --agent implementer
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
