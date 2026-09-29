#!/usr/bin/env bun
import { HELP } from "../src/help.ts";
import { runDonlyFile } from "../src/run-file.ts";

const fail = (message: string): never => {
  console.error(`${message}\n`);
  console.error(HELP);
  process.exit(1);
};

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(HELP);
  process.exit(0);
}

const dependencies: string[] = [];
const positional: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--dependency" || arg.startsWith("--dependency=")) {
    const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : args[++i];
    if (!value || value.startsWith("-")) fail("Option --dependency requires a package name");
    dependencies.push(value!);
  } else if (arg.startsWith("-")) {
    fail(`Unknown option: ${arg}`);
  } else {
    positional.push(arg);
  }
}

const filePath = positional[0];
if (!filePath) {
  console.log(HELP);
  process.exit(1);
}

const ok = await runDonlyFile(filePath, { dependencies });
process.exit(ok ? 0 : 1);
