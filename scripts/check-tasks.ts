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

  const file = Bun.file(join(import.meta.dir, "..", ".agents", taskFileFor(branch)));
  if (!(await file.exists())) {
    console.error(
      `Missing task file .agents/${taskFileFor(branch)}: every branch keeps its tasks there.`,
    );
    process.exit(1);
  }

  const [ok, error, content] = await result(file.text());
  if (!ok) throw error;

  const pending = pendingTasks(content);
  if (pending.length > 0) {
    console.error(`Branch "${branch}" has ${pending.length} pending task(s):`);
    for (const task of pending) console.error(`  ${task}`);
    process.exit(1);
  }
  console.log(`Branch "${branch}": no pending tasks.`);
}
