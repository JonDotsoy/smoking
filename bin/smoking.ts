#!/usr/bin/env bun
import { runDonlyFile } from "../src/run-file.ts";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: smoking <file.donly>");
  process.exit(1);
}

const ok = await runDonlyFile(filePath);
process.exit(ok ? 0 : 1);
