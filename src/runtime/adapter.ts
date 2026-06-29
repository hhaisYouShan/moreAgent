import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { AgentResult } from '../types';

export interface AdapterOptions {
  opencodePath: string;
  agentName: string;
  sessionId: string;
  prompt: string;
  task: string;
  primaryArtifact: string;
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
      options.primaryArtifact,
      options.context
    );
    const args = this.buildArgs(
      fullPrompt,
      options.agentName,
      options.sessionId
    );

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
        const chunk = data.toString();
        stdout += chunk;
        process.stdout.write(chunk);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        process.stderr.write(chunk);
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        this.writeLogs(options.artifactDir, stdout, stderr);
        resolve({
          success: code === 0,
          output: stdout,
          error: code !== 0 ? stderr || `Exit code: ${code}` : undefined,
          duration: Date.now() - startTime,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.writeLogs(options.artifactDir, stdout, stderr);
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
    primaryArtifact: string,
    context?: string
  ): string {
    const primaryPath = path.join(artifactDir, primaryArtifact);

    let full = prompt;

    full += `\n\n## Task\n${task}`;

    full += `\n\n## Artifact Output\nYour primary output file is: ${primaryPath}`;
    full += `\nYou MUST write your complete deliverable to this file.`;
    full += `\nAll artifact files are in: ${artifactDir}`;

    if (context) {
      full += `\n\n## Context from Previous Agents\n${context}`;
    }

    full += `\n\n## Instructions`;
    full += `\n1. Execute the task within the working directory.`;
    full += `\n2. Write your final deliverable to: ${primaryPath}`;
    full += `\n3. Use absolute paths when writing files.`;

    return full;
  }

  private buildArgs(
    prompt: string,
    agentName: string,
    sessionId: string
  ): string[] {
    void sessionId;
    return ['run', '--agent', agentName, prompt];
  }

  private writeLogs(
    artifactDir: string,
    stdout: string,
    stderr: string
  ): void {
    if (!fs.existsSync(artifactDir)) {
      fs.mkdirSync(artifactDir, { recursive: true });
    }
    fs.writeFileSync(path.join(artifactDir, 'stdout.log'), stdout, 'utf-8');
    if (stderr) {
      fs.writeFileSync(path.join(artifactDir, 'stderr.log'), stderr, 'utf-8');
    }
  }
}
