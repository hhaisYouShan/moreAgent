export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

export function printJsonError(code: string, message: string): never {
  printJson({ error: { code, message } });
  process.exit(1);
}

export function isJsonMode(args: string[]): boolean {
  return args.includes('--json');
}
