# OpenCode Native Session Research

## Date: 2026-06-29

## Conclusion: OpenCode SUPPORTS native session resume

### Verified Capabilities

| Feature | Command | Status |
|---|---|---|
| Start new session | `opencode run --agent <name> "prompt"` | ✅ |
| Continue last session | `opencode run -c "prompt"` | ✅ |
| Continue specific session | `opencode run -s <sessionId> "prompt"` | ✅ |
| Fork a session | `opencode run -s <sessionId> --fork "prompt"` | ✅ |
| List all sessions | `opencode session list` | ✅ |
| Export session JSON | `opencode export <sessionId>` | ✅ |
| Import session JSON | `opencode import <file>` | ✅ |
| JSON streaming output | `opencode run --format json "prompt"` | ✅ (events include `sessionID`) |
| Set session title | `opencode run --title "title" "prompt"` | ✅ |
| Session storage | SQLite database via `opencode db` | ✅ |

### Session ID Format

Session IDs are stable strings: `ses_0ec266226ffeP6VD3CQyD01U90`

### Test Verification

**Test 1: New session → Continue with context**
```bash
opencode run --agent architect "记住: 我是MoreAgent的architect agent"
# Creates session: ses_0ec266226ffeP6VD3CQyD01U90

opencode run -s "ses_0ec266226ffeP6VD3CQyD01U90" --agent architect "我刚才说了什么？"
# Output: 您说：您是 MoreAgent 项目的 architect agent
```
✅ Session context preserved across calls.

**Test 2: Fork a session**
```bash
opencode run -s "ses_0ec266226ffeP6VD3CQyD01U90" --fork --agent architect "下一步？"
# Creates: ses_0ec25a0bbffeEkTHX4XHNQ7j0Y (fork #1)
```
✅ Fork creates independent session with parent context.

### Implications for MoreAgent

1. **architect/implementer/tester/reviewer can each have persistent OpenCode sessions** across runs
2. **Repair rounds** (repair-1-implementer, repair-1-tester) can continue the SAME agent's conversation
3. **`-s <id>` is how to resume** — MoreAgent needs to capture and store session IDs
4. **Session discovery**: Use `--title "moreagent-<agentName>-<runId>"` to label sessions, then query `opencode session list` to find the ID

### Current MoreAgent Session vs OpenCode Session

| | MoreAgent Session | OpenCode Session |
|---|---|---|
| Scope | Per agent execution within a run | Per conversation history |
| Stored in | `.moreagent/sessions.json` | OpenCode SQLite DB |
| Resume capability | Read artifacts + logs | Continue conversation with full context |
| Across runs | By artifact passing only | By `-s <sessionId>` flag |

### Recommended Implementation Path

1. Add `runtimeSessionId?: string` to MoreAgent Session type
2. First call: `opencode run --title "moreagent-<agentName>" --agent <name> "prompt"`
3. Capture session ID via `opencode session list` filtered by title
4. Store in `.moreagent/sessions.json`
5. Subsequent calls (repair rounds): `opencode run -s <savedId> --agent <name> "prompt"`
6. Future: use `--fork` for branching repair attempts without polluting original session
