#!/usr/bin/env bun
import { fileURLToPath } from "node:url";
import { CliArgsError, CliMainArgs } from "../src/cli-main-args.ts";
import { HELP } from "../src/help.ts";
import { result } from "../src/result.ts";
import { runDonlyFile } from "../src/run-file.ts";

const [parsedOk, error, parsed] = result(() => new CliMainArgs().parse(process.argv.slice(2)));
if (!parsedOk) {
  if (!(error instanceof CliArgsError)) throw error;
  if (error.kind === "help") {
    console.log(HELP);
    process.exit(0);
  }
  if (error.kind === "invalid") {
    console.error(`${error.message}\n`);
    console.error(HELP);
  } else {
    console.log(HELP);
  }
  process.exit(1);
}

const { dependencies, runtime, file } = parsed!;
const ok = await runDonlyFile(fileURLToPath(file), { dependencies, runtime });
process.exit(ok ? 0 : 1);
