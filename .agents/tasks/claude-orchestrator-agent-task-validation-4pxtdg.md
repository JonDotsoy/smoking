# Tasks

- [x] Create the orchestrator agent (`.claude/agents/orchestrator.md`)
- [x] Document the task rules in `AGENTS.md`
- [x] Add `scripts/check-tasks.ts` and its tests
- [x] Add the `Tasks` workflow that blocks pending tasks
- [x] Add the SessionStart hook `.agents/scripts/session-start.sh` (tool and version warnings)
- [x] Task file is deleted only when the user asks to merge; the `Tasks` workflow fails while it exists
- [x] Move task files to `.agents/tasks/` and allow a `## Context` section

## Context

- The task file is the merge gate: it must be deleted (only when the user asks to merge) for the `Tasks` check to pass.
- The SessionStart hook is written in bash on purpose so it can still warn when `bun` is missing.
