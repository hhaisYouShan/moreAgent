import { addTask, listTasks, recoverRunningTasks, retryFailedTask, checkInit } from '../queue';

export interface QueueAddOptions {
  task: string;
}

export function queueAddCommand(options: QueueAddOptions): void {
  checkInit();
  const task = addTask(options.task);
  console.log(`Task added: ${task.id}`);
  console.log(`  Description: ${task.description}`);
  console.log(`  Status: ${task.status}`);
}

export interface QueueListOptions {
  all?: boolean;
}

export function queueListCommand(options: QueueListOptions = {}): void {
  checkInit();
  const tasks = listTasks(options.all);

  if (tasks.length === 0) {
    console.log('No tasks in queue.');
    console.log('Add one with: moreagent queue add --task "your task"');
    return;
  }

  console.log(`Tasks (${tasks.length}):`);
  for (const task of tasks) {
    const statusIcon =
      task.status === 'completed'
        ? 'OK'
        : task.status === 'failed'
          ? 'FAIL'
          : task.status === 'running'
            ? 'RUN'
            : 'PEND';
    console.log(`  ${task.id}`);
    console.log(`    Status: ${statusIcon}  |  ${task.description}`);
    if (task.retryOf) {
      console.log(`    Retry of: ${task.retryOf}`);
    }
    if (task.runId) {
      console.log(`    Run: ${task.runId}`);
    }
    console.log(`    Created: ${task.createdAt}`);
    if (task.startedAt) {
      console.log(`    Started: ${task.startedAt}`);
    }
    if (task.completedAt) {
      console.log(`    Completed: ${task.completedAt}`);
    }
    if (task.error) {
      console.log(`    Error: ${task.error}`);
    }
  }
}

export function queueRecoverCommand(): void {
  checkInit();
  const count = recoverRunningTasks();
  if (count === 0) {
    console.log('No running tasks to recover.');
  } else {
    console.log(`Recovered ${count} running task(s) → marked as failed.`);
  }
}

export interface QueueRetryOptions {
  task: string;
}

export function queueRetryCommand(options: QueueRetryOptions): void {
  checkInit();
  const task = retryFailedTask(options.task);
  console.log(`Retry task created: ${task.id}`);
  console.log(`  Description: ${task.description}`);
  console.log(`  Status: ${task.status}`);
  if (task.retryOf) {
    console.log(`  Retry of: ${task.retryOf}`);
  }
}
