#!/usr/bin/env node

import { cleanCommand } from './commands/clean';
import { diffCommand } from './commands/diff';
import { initCommand, type InitProfile } from './commands/init';
import { inspectCommand } from './commands/inspect';
import { mergeCommand } from './commands/merge';
import { queueAddCommand, queueListCommand, queueRecoverCommand, queueRetryCommand } from './commands/queue';
import { reportCommand } from './commands/report';
import {
  sessionsListCommand,
  sessionsResetCommand,
  sessionsResetAllCommand,
  sessionsExportCommand,
} from './commands/sessions';
import { statusCommand } from './commands/status';
import { startCommand } from './commands/start';
import { isJsonMode, printJsonError } from './output/json';

function exitWithError(message: string): never {
  if (isJsonMode(process.argv.slice(2))) {
    printJsonError('BAD_ARGS', message);
  }
  console.error(message);
  process.exit(1);
}

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
  report --latest           Show workflow report for latest run
  report --run <id>         Show workflow report for specific run
  clean                     Clean runs or worktrees
  sessions list             List agent runtime session mappings
  sessions reset --agent <n> Reset one agent's runtime session
  sessions reset --all      Reset all runtime sessions
  sessions export           Export runtime session registry

Start Options:
  --once                    Run a single task (requires --task)
  --task <description>      The task to execute (required for --once)
  --agent <name>            Run a specific agent only (optional)
  --loop                    Process all pending tasks from the queue
  --tmux                    Visualize execution in a tmux session

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
  moreagent report --latest
  moreagent report --run run-2026-06-29T12-00-00-abc123
  moreagent report --latest --json
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
      case 'init': {
        const profileIdx = args.indexOf('--profile');
        const profile: InitProfile =
          profileIdx !== -1 && args[profileIdx + 1] === 'full'
            ? 'full'
            : 'mvp';
        initCommand(profile);
        break;
      }

      case 'start': {
        const useTmux = args.includes('--tmux');
        const useResume = args.includes('--resume');
        const fromPhaseIdx = args.indexOf('--from-phase');
        const fromPhase = fromPhaseIdx !== -1 ? args[fromPhaseIdx + 1] : undefined;

        if (args.includes('--loop')) {
          await startCommand({ once: true, task: '', loop: true, tmux: useTmux });
          break;
        }

        if (useResume) {
          const resumeRunIdx = args.indexOf('--run');
          const resumeRunId = resumeRunIdx !== -1 ? args[resumeRunIdx + 1] : undefined;
          if (args.includes('--latest')) {
            await startCommand({ once: true, task: '', resume: true });
          } else if (resumeRunId) {
            await startCommand({ once: true, task: '', resume: true, resumeRunId });
          } else {
            exitWithError('Error: --resume requires --run <id> or --latest');
          }
          break;
        }

        if (!args.includes('--once')) {
          exitWithError('Error: use --once, --loop, or --resume with start command');
        }

        if (fromPhase && !args.includes('--task')) {
          exitWithError('Error: --task is required with --from-phase');
        }

        const taskIdx = args.indexOf('--task');
        const task = taskIdx !== -1 ? args[taskIdx + 1] : '';

        const agentIdx = args.indexOf('--agent');
        const agent = agentIdx !== -1 ? args[agentIdx + 1] : undefined;

        await startCommand({ once: true, task, agent, tmux: useTmux, fromPhase });
        break;
      }

      case 'queue': {
        const sub = args[1];
        if (sub === 'add') {
          const qTaskIdx = args.indexOf('--task');
          if (qTaskIdx === -1 || !args[qTaskIdx + 1]) {
            exitWithError('Error: --task <description> is required for queue add');
          }
          queueAddCommand({ task: args[qTaskIdx + 1] });
        } else if (sub === 'list') {
          queueListCommand({ all: args.includes('--all') });
        } else if (sub === 'recover') {
          queueRecoverCommand();
        } else if (sub === 'retry') {
          const retryIdx = args.indexOf('--task');
          if (retryIdx === -1 || !args[retryIdx + 1]) {
            exitWithError('Error: --task <taskId> is required for queue retry');
          }
          queueRetryCommand({ task: args[retryIdx + 1] });
        } else {
          exitWithError('Usage: moreagent queue <add|list|recover|retry>');
        }
        break;
      }

      case 'status': {
        const statusRunIdx = args.indexOf('--run');
        const statusRunId = statusRunIdx !== -1 ? args[statusRunIdx + 1] : undefined;
        statusCommand({
          latest: args.includes('--latest') && !args.includes('--latest-repair') && !args.includes('--latest-full'),
          latestRepair: args.includes('--latest-repair'),
          latestFull: args.includes('--latest-full'),
          run: statusRunId,
          summary: args.includes('--summary'),
          json: args.includes('--json'),
        });
        break;
      }

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
        inspectCommand({ run: inspectRunId, agent: inspectAgent, workflow: args.includes('--workflow'), json: args.includes('--json') });
        break;
      }

      case 'sessions': {
        const sub = args[1];
        if (sub === 'list') {
          sessionsListCommand();
        } else if (sub === 'reset') {
          if (args.includes('--all')) {
            sessionsResetAllCommand();
          } else {
            const agentIdx = args.indexOf('--agent');
            if (agentIdx === -1 || !args[agentIdx + 1]) {
              exitWithError('Usage: moreagent sessions reset --agent <name> or --all');
            }
            sessionsResetCommand(args[agentIdx + 1]);
          }
        } else if (sub === 'export') {
          sessionsExportCommand(args.includes('--json'));
        } else {
          exitWithError('Usage: moreagent sessions <list|reset|export>');
        }
        break;
      }

      case 'report': {
        const reportRunIdx = args.indexOf('--run');
        const reportRunId = reportRunIdx !== -1 ? args[reportRunIdx + 1] : undefined;
        reportCommand({
          latest: args.includes('--latest') && !reportRunId,
          run: reportRunId,
          json: args.includes('--json'),
        });
        break;
      }

      case 'merge': {
        const mergeRunIdx = args.indexOf('--run');
        const mergeRunId = mergeRunIdx !== -1 ? args[mergeRunIdx + 1] : undefined;
        mergeCommand({
          run: mergeRunId,
          latest: args.includes('--latest'),
          apply: args.includes('--apply'),
          dryRun: !args.includes('--apply'),
        });
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
        exitWithError(`Unknown command: ${command}`);
    }
  } catch (err: any) {
    if (args.includes('--json')) {
      printJsonError('INTERNAL_ERROR', err.message);
    }
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
