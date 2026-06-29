import { addTask, listTasks } from '../queue';

export interface QueueAddOptions {
  task: string;
}

export function queueAddCommand(options: QueueAddOptions): void {
  const task = addTask(options.task);
  console.log(`Task added: ${task.id}`);
  console.log(`  Description: ${task.description}`);
  console.log(`  Status: ${task.status}`);
}

export function queueListCommand(): void {
  const tasks = listTasks();

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
    if (task.runId) {
      console.log(`    Run: ${task.runId}`);
    }
    console.log(`    Created: ${task.createdAt}`);
    if (task.error) {
      console.log(`    Error: ${task.error}`);
    }
  }
}
