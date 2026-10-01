#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CliArgsError, CliMainArgs } from "../src/cli-main-args.ts";
import { HELP } from "../src/help.ts";
import { play, parsePlayableCases } from "../src/play.ts";
import { serveReportUI } from "../src/play-ui.ts";
import { result } from "../src/utils/result.ts";
import { runDonlyFile } from "../src/run-file.ts";

// `smoking run <manifest.donly>` runs a manifest; the bare `smoking <manifest>`
// form still works, but only `run` is safe for a file named like a command
// (`smoking run play`).
const args = process.argv.slice(2);
const command = args[0] === "run" || args[0] === "play" ? args.shift() : undefined;

if (command === "play") {
  const ui = args.includes("--ui");
  const positional = args.filter((arg) => arg !== "--ui");
  const reportFile = positional[0];
  if (!reportFile || positional.length > 1) {
    console.error("Usage: smoking play [--ui] <report file>");
    process.exit(1);
  }
  const [playOk, playError] = await result(async () => {
    const text = await Bun.file(reportFile).text();
    if (!ui) return play(parsePlayableCases(text));
    const server = serveReportUI(text);
    console.error(`Player at ${server.url} (Ctrl+C to stop)`);
    await new Promise(() => {}); // serve until interrupted
  });
  if (!playOk) {
    console.error(
      `Could not play ${reportFile}: ${playError instanceof Error ? playError.message : playError}`,
    );
    process.exit(1);
  }
  process.exit(0);
}

const [parsedOk, error, parsed] = result(() => new CliMainArgs().parse(args));
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
