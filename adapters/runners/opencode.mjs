import { buildPromptInput, createCommandRunnerAdapter } from './command-runner.mjs';

export function createOpenCodeRunner({
  processRunner,
  runnerId = 'opencode',
  executable = 'opencode',
  baseArgs = ['run'],
  promptTransport = 'ARGUMENT',
} = {}) {
  return createCommandRunnerAdapter({
    runnerId,
    runnerType: 'OPENCODE',
    capabilities: ['CHAT_SESSION', 'CODE_EDIT', 'SELF_TEST'],
    processRunner,
    buildInvocation(request) {
      const prompt = request.prompt || buildPromptInput(request);
      const args = [...baseArgs];
      if (request.agentId) args.push('--agent', request.agentId);
      if (request.sessionId) args.push('--session', request.sessionId);
      if (promptTransport === 'STDIN') {
        return { command: executable, args, stdin: prompt };
      }
      args.push(prompt);
      return { command: executable, args };
    },
  });
}
