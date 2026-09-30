import { expect, test } from "bun:test";
import { pendingTasks, taskFileFor } from "../scripts/check-tasks.ts";

test("taskFileFor maps a branch name to a flat file name", () => {
  expect(taskFileFor("claude/my-branch")).toBe("claude-my-branch.md");
});

test("pendingTasks only returns unchecked tasks", () => {
  const content = "# T\n- [x] done\n- [ ] todo\n  * [ ] nested\n- [X] Done too\n";
  expect(pendingTasks(content)).toEqual(["- [ ] todo", "* [ ] nested"]);
});
