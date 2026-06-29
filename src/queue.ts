import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getMoreAgentDir } from './config';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  runId: string;
  error: string;
  retryOf?: string;
}

export interface TasksData {
  tasks: Task[];
}

const TASKS_FILE = 'tasks.json';

function getTasksPath(): string {
  return path.join(getMoreAgentDir(), TASKS_FILE);
}

function readTasks(): TasksData {
  const tasksPath = getTasksPath();
  if (!fs.existsSync(tasksPath)) {
    return { tasks: [] };
  }
  const content = fs.readFileSync(tasksPath, 'utf-8');
  return JSON.parse(content) as TasksData;
}

function writeTasks(data: TasksData): void {
  const tasksPath = getTasksPath();
  fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2), 'utf-8');
}

export function checkInit(): string {
  const dir = getMoreAgentDir();
  if (!fs.existsSync(dir)) {
    throw new Error(
      'MoreAgent is not initialized in this directory.\n' +
        'Run: moreagent init'
    );
  }
  return dir;
}

export function addTask(description: string): Task {
  checkInit();
  const data = readTasks();
  const now = new Date().toISOString();
  const id = `task-${now.replace(/[:.]/g, '-').slice(0, 19)}-${uuidv4().slice(0, 6)}`;
  const task: Task = {
    id,
    description,
    status: 'pending',
    createdAt: now,
    startedAt: '',
    completedAt: '',
    runId: '',
    error: '',
  };
  data.tasks.push(task);
  writeTasks(data);
  return task;
}

export function getNextPendingTask(): Task | null {
  const data = readTasks();
  return data.tasks.find((t) => t.status === 'pending') || null;
}

export function hasRunningTasks(): number {
  const data = readTasks();
  return data.tasks.filter((t) => t.status === 'running').length;
}

export function markTaskRunning(taskId: string): void {
  updateTask(taskId, { status: 'running', startedAt: new Date().toISOString() });
}

export function markTaskCompleted(taskId: string, runId: string): void {
  updateTask(taskId, {
    status: 'completed',
    runId,
    completedAt: new Date().toISOString(),
  });
}

export function markTaskFailed(taskId: string, runId: string, error: string): void {
  updateTask(taskId, {
    status: 'failed',
    runId,
    error,
    completedAt: new Date().toISOString(),
  });
}

function updateTask(taskId: string, updates: Partial<Task>): void {
  const data = readTasks();
  const task = data.tasks.find((t) => t.id === taskId);
  if (task) {
    Object.assign(task, updates);
    writeTasks(data);
  }
}

export function recoverRunningTasks(): number {
  checkInit();
  const data = readTasks();
  const now = new Date().toISOString();
  let count = 0;

  for (const task of data.tasks) {
    if (task.status === 'running') {
      task.status = 'failed';
      task.error = 'Marked stale by queue recover';
      task.completedAt = now;
      count++;
    }
  }

  if (count > 0) {
    writeTasks(data);
  }

  return count;
}

export function retryFailedTask(taskId: string): Task {
  checkInit();
  const data = readTasks();
  const original = data.tasks.find((t) => t.id === taskId);

  if (!original) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (original.status !== 'failed') {
    throw new Error(
      `Task ${taskId} is not failed (status: ${original.status}). Only failed tasks can be retried.`
    );
  }

  const now = new Date().toISOString();
  const id = `task-${now.replace(/[:.]/g, '-').slice(0, 19)}-${uuidv4().slice(0, 6)}`;
  const task: Task = {
    id,
    description: original.description,
    status: 'pending',
    createdAt: now,
    startedAt: '',
    completedAt: '',
    runId: '',
    error: '',
    retryOf: original.id,
  };

  data.tasks.push(task);
  writeTasks(data);
  return task;
}

export function listTasks(all?: boolean): Task[] {
  const data = readTasks();
  const sorted = [...data.tasks].reverse();
  return all ? sorted : sorted.slice(0, 20);
}

export function initTasksFile(): void {
  const tasksPath = getTasksPath();
  if (!fs.existsSync(tasksPath)) {
    writeTasks({ tasks: [] });
  }
}
