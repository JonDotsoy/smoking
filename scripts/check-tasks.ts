import { join } from "node:path";
import { result } from "../src/utils/result.ts";

export const taskFileFor = (branch: string) => `${branch.replace(/[^A-Za-z0-9._-]+/g, "-")}.md`;

/** Returns the unchecked task lines (`- [ ] ...`) of a task file. */
export const pendingTasks = (content: string) =>
  content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*] \[ \]/.test(line));

if (import.meta.main) {
  const branch = process.argv[2];
  if (!branch) {
    console.error("Usage: bun scripts/check-tasks.ts <branch>");
    process.exit(2);
  }

  const path = `.agents/${taskFileFor(branch)}`;
  const file = Bun.file(join(import.meta.dir, "..", path));
  if (!(await file.exists())) {
    console.log(`Branch "${branch}": no task file, ready to merge.`);
    process.exit(0);
  }

  const [ok, error, content] = await result(file.text());
  if (!ok) throw error;

  const pending = pendingTasks(content);
  console.error(
    `Branch "${branch}" still has its task file ${path} (${pending.length} pending task(s)).`,
  );
  for (const task of pending) console.error(`  ${task}`);
  console.error("The task file is deleted only when the user asks to merge the branch.");
  process.exit(1);
}
