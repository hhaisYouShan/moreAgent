import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export async function prepareCodexTaskScript({ repoRoot, runDir, task, worktreePath, promptContent, model, engine = 'codex' }) {
  const taskDir = path.join(runDir, task.id);
  const guardDir = path.join(taskDir, 'bin');
  await mkdir(taskDir, { recursive: true });
  await mkdir(guardDir, { recursive: true });

  const promptPath = path.join(taskDir, 'prompt.md');
  const logPath = path.join(taskDir, `${engine}.log`);
  const statusPath = path.join(taskDir, 'status.json');
  const scriptPath = path.join(taskDir, 'run.sh');
  const gitGuardPath = path.join(guardDir, 'git');
  const normalizedEngine = normalizeEngine(engine);
  const realGitPath = resolveGitPath();

  await writeFile(promptPath, promptContent, 'utf8');
  await writeFile(gitGuardPath, renderGitGuard({ realGitPath }), { encoding: 'utf8', mode: 0o755 });

  const script = `#!/usr/bin/env bash
set -u
REPO_ROOT=${shellQuote(repoRoot)}
WORKTREE=${shellQuote(worktreePath)}
PROMPT_FILE=${shellQuote(promptPath)}
LOG_FILE=${shellQuote(logPath)}
STATUS_FILE=${shellQuote(statusPath)}
GIT_GUARD_BIN=${shellQuote(guardDir)}
MODEL=${shellQuote(model)}
ENGINE=${shellQuote(normalizedEngine)}
TASK_AGENT=${shellQuote(task.agent)}
TASK_ID=${shellQuote(task.id)}
TASK_DISPLAY_NAME=${shellQuote(task.displayName || task.windowName || task.title || task.id)}
TASK_RESPONSIBILITY=${shellQuote(task.responsibility || task.title || '')}
OPENCODE_NATIVE_AGENT=${shellQuote(process.env.AGENT_LOOP_OPENCODE_NATIVE_AGENT || 'true')}

write_status() {
  local status="$1"
  local exit_code="$2"
  local reason="$3"
  printf '{"task":"%s","agent":"%s","displayName":"%s","engine":"%s","status":"%s","exitCode":%s,"reason":"%s"}\n' "$TASK_ID" "$TASK_AGENT" "$TASK_DISPLAY_NAME" "$ENGINE" "$status" "$exit_code" "$reason" > "$STATUS_FILE"
}

on_abort() {
  local code="$?"
  echo "[agent-loop] 状态：已中断，信号退出码：$code" | tee -a "$LOG_FILE"
  if [ ! -f "$STATUS_FILE" ]; then
    write_status aborted 130 received_signal
  fi
  exit 130
}

on_exit() {
  local code="$?"
  if [ ! -f "$STATUS_FILE" ]; then
    echo "[agent-loop] 状态：脚本退出但未写 status.json，退出码：$code" | tee -a "$LOG_FILE"
    write_status failed "$code" script_exited_without_status
  fi
}

trap on_abort HUP INT TERM
trap on_exit EXIT

cd "$REPO_ROOT"
export PATH="$GIT_GUARD_BIN:$PATH"
{
  echo "[agent-loop] 当前子 Agent：$TASK_DISPLAY_NAME"
  echo "[agent-loop] 职责：$TASK_RESPONSIBILITY"
  echo "[agent-loop] 状态：运行中"
  echo "[agent-loop] task=$TASK_ID agent=$TASK_AGENT engine=$ENGINE worktree=$WORKTREE"
  echo "[agent-loop] OpenCode native agent: $OPENCODE_NATIVE_AGENT"
  echo "[agent-loop] Git mutation guard: enabled"
} | tee "$LOG_FILE"

if [ "$ENGINE" = "opencode" ]; then
  if [ "$OPENCODE_NATIVE_AGENT" = "true" ]; then
    opencode run --dir "$WORKTREE" --model "$MODEL" --agent "$TASK_AGENT" --auto "$(cat "$PROMPT_FILE")" 2>&1 | tee -a "$LOG_FILE"
  else
    opencode run --dir "$WORKTREE" --model "$MODEL" --auto "$(cat "$PROMPT_FILE")" 2>&1 | tee -a "$LOG_FILE"
  fi
else
  codex -C "$WORKTREE" -m "$MODEL" -s workspace-write -a never exec "$(cat "$PROMPT_FILE")" 2>&1 | tee -a "$LOG_FILE"
fi
EXIT_CODE=\${PIPESTATUS[0]}

if grep -Fqi 'Falling back to default agent' "$LOG_FILE" || grep -Fqi 'agent "' "$LOG_FILE" && grep -Fqi 'not found' "$LOG_FILE"; then
  echo "[agent-loop] 状态：失败，OpenCode 原生 Agent 未注册或未被识别：$TASK_AGENT" | tee -a "$LOG_FILE"
  write_status failed 1 agent_not_found
  exit 1
fi

if grep -Fqi '[agent-loop] blocked git command from sub-agent' "$LOG_FILE"; then
  echo "[agent-loop] 状态：失败，子 Agent 尝试执行被禁止的 git 写操作。" | tee -a "$LOG_FILE"
  write_status failed 1 git_mutation_blocked
  exit 1
fi

if [ "$EXIT_CODE" -eq 0 ]; then
  echo "[agent-loop] 状态：已完成" | tee -a "$LOG_FILE"
  write_status done 0 completed
else
  echo "[agent-loop] 状态：失败，退出码：$EXIT_CODE" | tee -a "$LOG_FILE"
  write_status failed "$EXIT_CODE" engine_exit_nonzero
fi

exit "$EXIT_CODE"
`;

  await writeFile(scriptPath, script, { encoding: 'utf8', mode: 0o755 });
  return { taskDir, promptPath, logPath, statusPath, scriptPath };
}

function renderGitGuard({ realGitPath }) {
  return `#!/usr/bin/env bash
set -u
REAL_GIT=${shellQuote(realGitPath)}
COMMAND="\${1:-}"
case "$COMMAND" in
  status|diff|log|show|ls-files|rev-parse|grep|describe)
    exec "$REAL_GIT" "$@"
    ;;
  *)
    echo "[agent-loop] blocked git command from sub-agent: git $*" >&2
    echo "[agent-loop] 子 Agent 禁止执行 git add/commit/push/pull/rebase/merge 等写操作。Agent 只产出文件，提交/同步由 Orchestrator 控制。" >&2
    exit 77
    ;;
esac
`;
}

function resolveGitPath() {
  const result = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) return '/usr/bin/git';
  const which = spawnSync('which', ['git'], { encoding: 'utf8' });
  return which.status === 0 ? which.stdout.trim() : '/usr/bin/git';
}

function normalizeEngine(value) {
  return String(value || 'codex').trim().toLowerCase() === 'opencode' ? 'opencode' : 'codex';
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
