#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CliArgsError, CliMainArgs } from "../src/cli-main-args.ts";
import { HELP } from "../src/help.ts";
import { play, parsePlayableCases } from "../src/play.ts";
import { result } from "../src/utils/result.ts";
import { runDonlyFile } from "../src/run-file.ts";

if (process.argv[2] === "play") {
  const reportFile = process.argv[3];
  if (!reportFile || process.argv.length > 4) {
    console.error("Usage: smoking play <report file>");
    process.exit(1);
  }
  const [playOk, playError] = await result(async () => {
    const text = await Bun.file(reportFile).text();
    await play(parsePlayableCases(text));
  });
  if (!playOk) {
    console.error(
      `Could not play ${reportFile}: ${playError instanceof Error ? playError.message : playError}`,
    );
    process.exit(1);
  }
  process.exit(0);
}

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

const { dependencies, runtime, file, json, capture, output } = parsed!;
const report = await runDonlyFile(fileURLToPath(file), { dependencies, runtime, json, capture });
const reportJson = JSON.stringify(report, null, 2) + "\n";

if (output !== undefined) {
  const outputPath = fileURLToPath(output);
  const [saved, saveError] = await result(async () => {
    await mkdir(dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, reportJson);
  });
  if (!saved) {
    console.error(
      `Could not save the report to ${outputPath}: ${saveError instanceof Error ? saveError.message : saveError}`,
    );
    process.exit(1);
  }
}
if (json) process.stdout.write(reportJson);
process.exit(report.ok ? 0 : 1);
