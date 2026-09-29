#!/usr/bin/env bun
import { HELP } from "../src/help.ts";
import { runDonlyFile } from "../src/run-file.ts";

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(HELP);
  process.exit(0);
}

const unknownOption = args.find((arg) => arg.startsWith("-"));
if (unknownOption) {
  console.error(`Unknown option: ${unknownOption}\n`);
  console.error(HELP);
  process.exit(1);
}

const filePath = args[0];
if (!filePath) {
  console.log(HELP);
  process.exit(1);
}

const ok = await runDonlyFile(filePath);
process.exit(ok ? 0 : 1);
