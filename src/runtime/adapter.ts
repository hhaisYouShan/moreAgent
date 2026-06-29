import { spawn } from 'child_process';
import { AgentResult } from '../types';

export interface AdapterOptions {
  opencodePath: string;
  agentName: string;
  sessionId: string;
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

    const fullPrompt = this.buildFullPrompt(
      prompt,
      task,
      options.artifactDir,
      options.context
    );
    const args = this.buildArgs(fullPrompt, options.agentName, options.sessionId);

    return new Promise<AgentResult>((resolve) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn(opencodePath, args, {
        cwd: workingDir,
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
    artifactDir: string,
    context?: string
  ): string {
    let full = prompt;

    full += `\n\n## Task\n${task}`;

    full += `\n\n## Output Directory\nYour artifact output directory is: ${artifactDir}`;
    full += `\nAll your findings and deliverables MUST be written to files in this directory.`;

    if (context) {
      full += `\n\n## Context from Previous Agents\n${context}`;
    }

    full += `\n\n## Instructions\n1. Read the task carefully and execute it within your working directory.`;
    full += `\n2. Write your complete output to the appropriate artifact files in ${artifactDir}.`;
    full += `\n3. Use absolute paths when writing files.`;

    return full;
  }

  private buildArgs(
    prompt: string,
    agentName: string,
    sessionId: string
  ): string[] {
    return ['run', '--agent', agentName, '--session', sessionId, prompt];
  }
}
