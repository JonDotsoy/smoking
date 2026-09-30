# Agents

Read `CLAUDE.md` for the project conventions (Bun, `result()`, testing).

## Orchestrator

`.claude/agents/orchestrator.md` defines the orchestrator agent. Use it for
work that has several steps: it plans, records tasks, delegates and verifies.

## Task rules

- Every new branch keeps its tasks in a file inside `.agents/tasks/`, named
  after the branch with `/` replaced by `-` (`claude/foo` →
  `.agents/tasks/claude-foo.md`).
- Tasks are a Markdown checklist: `- [ ]` pending, `- [x]` done.
- The agent may also record the context of the process in the same file, under
  a `## Context` section: decisions and why, findings, blockers, open questions.
  Only the `- [ ]` lines count as tasks; the rest is free text.
- The task file is deleted only when the agent is ready to merge, and that
  happens only when the user asks for it. Never delete it on your own.
- A branch cannot be merged into `develop` while its task file exists (it means
  work is still open, and any `- [ ]` task is pending). The `Tasks` workflow
  (`.github/workflows/tasks.yaml`) fails pull requests to `develop` while the
  file exists; run it locally with `bun scripts/check-tasks.ts <branch>`.
- Mark a task done only when it is finished and verified.

## Session start

`.claude/settings.json` runs `.agents/scripts/session-start.sh` on every new
session. It checks that `git` and `bun` are installed and meet the minimum
version, and warns the user if not. It never blocks the session (always exits
0). Add tools to the `REQUIREMENTS` list in the script.
