import { buildPromptInput, createCommandRunnerAdapter } from './command-runner.mjs';

export function createCodexRunner({
  processRunner,
  runnerId = 'codex',
  executable = 'codex',
  baseArgs = ['exec'],
  promptTransport = 'STDIN',
} = {}) {
  return createCommandRunnerAdapter({
    runnerId,
    runnerType: 'CODEX',
    capabilities: ['HEADLESS', 'CODE_EDIT', 'SELF_TEST', 'STRUCTURED_OUTPUT'],
    processRunner,
    buildInvocation(request) {
      const prompt = request.prompt || buildPromptInput(request);
      const args = [...baseArgs];
      if (request.model) args.push('--model', request.model);
      if (request.outputSchemaPath) args.push('--output-schema', request.outputSchemaPath);
      if (promptTransport === 'ARGUMENT') {
        args.push(prompt);
        return { command: executable, args };
      }
      args.push('-');
      return { command: executable, args, stdin: prompt };
    },
  });
}
