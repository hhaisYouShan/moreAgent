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

export function addTask(description: string): Task {
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

export function listTasks(): Task[] {
  const data = readTasks();
  return [...data.tasks].reverse().slice(0, 20);
}

export function initTasksFile(): void {
  const tasksPath = getTasksPath();
  if (!fs.existsSync(tasksPath)) {
    writeTasks({ tasks: [] });
  }
}
