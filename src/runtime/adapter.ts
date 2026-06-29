import { spawn } from 'child_process';
import * as path from 'path';
import { AgentResult } from '../types';

export interface AdapterOptions {
  opencodePath: string;
  agentName: string;
  prompt: string;
  task: string;
  workingDir: string;
  artifactDir: string;
  timeout: number;
  context?: string;
}

export class OpenCodeRuntimeAdapter {
  constructor(private readonly defaultTimeout: number = 1800) {}

  async execute(options: AdapterOptions): Promise<AgentResult> {
    const startTime = Date.now();
    const { opencodePath, prompt, task, workingDir, timeout } = options;
    const effectiveTimeout = timeout || this.defaultTimeout;

    const fullPrompt = this.buildFullPrompt(prompt, task, options.context);
    const args = this.buildArgs(fullPrompt);

    return new Promise<AgentResult>((resolve) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn(opencodePath, args, {
        cwd: workingDir,
        env: {
          ...process.env,
          OPENCODE_SESSION_ID: `${options.agentName}-${Date.now()}`,
        },
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({
          success: false,
          output: stdout,
          error: `Timeout after ${effectiveTimeout} seconds`,
          duration: Date.now() - startTime,
        });
      }, effectiveTimeout * 1000);

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          success: code === 0,
          output: stdout,
          error: code !== 0 ? stderr || `Exit code: ${code}` : undefined,
          duration: Date.now() - startTime,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          output: stdout,
          error: err.message,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  private buildFullPrompt(
    prompt: string,
    task: string,
    context?: string
  ): string {
    let full = `${prompt}\n\n## Current Task\n${task}`;
    if (context) {
      full += `\n\n## Context from Previous Agents\n${context}`;
    }
    full +=
      '\n\n## Instructions\nComplete the task and write your findings to the appropriate artifact files in the output directory.';
    return full;
  }

  private buildArgs(prompt: string): string[] {
    return ['run', prompt];
  }
}
