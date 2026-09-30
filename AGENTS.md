# Agents

Read `CLAUDE.md` for the project conventions (Bun, `result()`, testing).

## Orchestrator

`.claude/agents/orchestrator.md` defines the orchestrator agent. Use it for
work that has several steps: it plans, records tasks, delegates and verifies.

## Task rules

- Every new branch keeps its tasks in a file inside `.agents/`, named after the
  branch with `/` replaced by `-` (`claude/foo` → `.agents/claude-foo.md`).
- Tasks are a Markdown checklist: `- [ ]` pending, `- [x]` done.
- A branch cannot be merged into `develop` while its task file has pending
  tasks (or does not exist). The `Tasks` workflow
  (`.github/workflows/tasks.yaml`) enforces this on pull requests to `develop`;
  run it locally with `bun scripts/check-tasks.ts <branch>`.
- Mark a task done only when it is finished and verified.
