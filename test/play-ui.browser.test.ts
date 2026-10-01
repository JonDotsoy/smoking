import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { CLI_PATH, REPO_ROOT, runCliWithArgs } from "./helpers.ts";

// Chromium: $SMOKING_CHROMIUM, the one Playwright installed, or the sandbox's.
// Without a browser these tests are skipped.
const chromiumPath = [
  process.env.SMOKING_CHROMIUM,
  chromium.executablePath(),
  "/opt/pw-browsers/chromium",
].find((path) => path && existsSync(path));

// Starts `smoking play --ui <report>` and opens its player in Chromium.
const openPlayer = async (report: string) => {
  const server = Bun.spawn(["bun", CLI_PATH, "play", "--ui", report], {
    cwd: REPO_ROOT,
    stdout: "ignore",
    stderr: "pipe",
  });
  // The CLI prints "Player at <url> (Ctrl+C to stop)" on stderr.
  const reader = (server.stderr as ReadableStream<Uint8Array>).getReader();
  let output = "";
  while (!/Player at (\S+)/.test(output)) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`play --ui exited early:\n${output}`);
    output += new TextDecoder().decode(value);
  }
  const url = /Player at (\S+)/.exec(output)![1]!;

  const browser = await chromium.launch({ executablePath: chromiumPath! });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await page.goto(url); // `/` redirects to `/?report=/report.json`
  await page.waitForSelector("#window:not([hidden])");
  return { server, url, browser, page };
};

// Browser-side code is passed as strings: the tests don't use the DOM lib types.
const seekTo = (page: Page, ms: number) =>
  page.evaluate(`(() => {
    const input = document.getElementById("seek");
    input.value = "${ms}";
    input.dispatchEvent(new Event("input"));
  })()`);
const terminalText = async (page: Page) =>
  (await page.innerText("#term")).replace(/[ \t]+$/gm, "").trimEnd();

const enc = (text: string) => [...new TextEncoder().encode(text)];
const chunk = (elapse: number, stream: "stdout" | "stderr", text: string) => ({
  elapse,
  stream,
  buffer: enc(text),
});

const REPORT = {
  cases: [
    {
      name: "first",
      cast: {
        startAt: 0,
        chunks: [
          chunk(100, "stdout", "\x1b[1;32mBuild\x1b[0m starting\n"),
          chunk(400, "stdout", "progress 10%"),
          chunk(700, "stdout", "\rprogress 100%\n"),
          chunk(1000, "stderr", "\x1b[31mwarn: ñ\x1b[0m\n"),
        ],
      },
    },
    { name: "second", cast: { startAt: 0, chunks: [chunk(50, "stdout", "other case\n")] } },
  ],
};

describe.skipIf(!chromiumPath)("smoking play --ui (browser)", () => {
  let dir: string;
  let server: ReturnType<typeof Bun.spawn>;
  let url: string;
  let browser: Browser;
  let page: Page;

  const seek = (ms: number) => seekTo(page, ms);
  const terminal = () => terminalText(page);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "smoking-play-ui-"));
    const report = join(dir, "report.json");
    await writeFile(report, JSON.stringify(REPORT));
    ({ server, url, browser, page } = await openPlayer(report));
  });

  afterAll(async () => {
    await browser?.close();
    server?.kill();
    await rm(dir, { recursive: true, force: true });
  });

  test("loads the report and lists its cases", async () => {
    expect(page.url()).toBe(`${url}?report=/report.json`);
    expect(await page.locator("#case option").allInnerTexts()).toEqual(["first", "second"]);
    expect(await page.innerText("#title")).toContain("first · 4 chunks · 80×24");
    expect(await page.innerText("#time")).toBe("0.000 / 1.000 s");
  });

  test("scrubbing the time bar paints the terminal state at that time", async () => {
    await seek(0);
    expect(await terminal()).toBe("");

    await seek(500);
    expect(await terminal()).toBe("Build starting\nprogress 10%");

    // `\r` rewrites the line instead of appending to it
    await seek(800);
    expect(await terminal()).toBe("Build starting\nprogress 100%");

    await seek(1000);
    expect(await terminal()).toBe("Build starting\nprogress 100%\nwarn: ñ");
  });

  test("renders colors", async () => {
    await seek(1000);
    const color = (text: string) =>
      page.evaluate<string>(`(() => {
        const span = [...document.querySelectorAll("#term span")].find((e) =>
          e.textContent.includes(${JSON.stringify(text)}),
        );
        return getComputedStyle(span).color;
      })()`);
    expect(await color("Build")).toBe("rgb(13, 188, 121)");
    expect(await color("warn: ñ")).toBe("rgb(205, 49, 49)");
  });

  test("plays from the start up to the end", async () => {
    await page.selectOption("#speed", "4");
    await seek(0);
    await page.click("#play");
    await page.waitForFunction('document.getElementById("time").textContent.startsWith("1.000")');
    expect(await terminal()).toBe("Build starting\nprogress 100%\nwarn: ñ");
    await page.waitForFunction('document.getElementById("play").textContent === "▶"');
  });

  test("switching the case loads its own cast", async () => {
    await page.selectOption("#case", "1");
    expect(await page.innerText("#title")).toContain("second · 1 chunks");
    await seek(50);
    expect(await terminal()).toBe("other case");
  });

  test("the served report is the one it plays", async () => {
    const served = await fetch(new URL("/report.json", url));
    expect(await served.json()).toEqual(REPORT);
  });
});

const SCRIPT = `case logs {
  env FORCE_COLOR 1
  run <<<ts
    const pause = () => Bun.sleep(60);
    console.log("one");
    await pause();
    console.error("two (error)");
    await pause();
    console.log("three");
    console.log("four");
    await pause();
    console.error("five (error)");
    await pause();
    console.log("six");
    await pause();
    console.log({ count: 7 });
}
`;

describe.skipIf(!chromiumPath)("smoking play --ui with a recorded script (browser)", () => {
  let dir: string;
  let server: ReturnType<typeof Bun.spawn>;
  let browser: Browser;
  let page: Page;
  let chunks: { elapse: number; stream: string; buffer: number[] }[];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "smoking-play-ui-script-"));
    const donly = join(dir, "logs.donly");
    const report = join(dir, "report.json");
    await writeFile(donly, SCRIPT);
    // Record a real run: the script's console.log/console.error end up in the cast.
    const run = runCliWithArgs(["--output", report, donly]);
    if (run.exitCode !== 0) throw new Error(`the script failed:\n${run.stdout}\n${run.stderr}`);
    chunks = (await Bun.file(report).json()).cases[0].cast.chunks;
    ({ server, browser, page } = await openPlayer(report));
  });

  afterAll(async () => {
    await browser?.close();
    server?.kill();
    await rm(dir, { recursive: true, force: true });
  });

  const at = (text: string) => chunks.find((c) => String.fromCharCode(...c.buffer).includes(text))!;
  const when = (text: string) => Math.ceil(at(text).elapse);

  test("the cast keeps every line on its own stream", () => {
    const lines = chunks.flatMap((c) =>
      String.fromCharCode(...c.buffer)
        .replace(/\x1b\[[0-9;]*m/g, "") // colors
        .split("\n")
        .filter(Boolean)
        .map((line) => [c.stream, line]),
    );
    expect(lines).toEqual([
      ["stdout", "one"],
      ["stderr", "two (error)"],
      ["stdout", "three"],
      ["stdout", "four"],
      ["stderr", "five (error)"],
      ["stdout", "six"],
      ["stdout", "{"],
      ["stdout", "  count: 7,"],
      ["stdout", "}"],
    ]);
  });

  test("the player shows the lines as they were written, stdout and stderr in order", async () => {
    expect(await page.innerText("#title")).toContain(`logs · ${chunks.length} chunks`);

    await seekTo(page, 0);
    expect(await terminalText(page)).toBe("");

    await seekTo(page, when("one"));
    expect(await terminalText(page)).toBe("one");

    await seekTo(page, when("two"));
    expect(await terminalText(page)).toBe("one\ntwo (error)");

    await seekTo(page, when("four"));
    expect(await terminalText(page)).toBe("one\ntwo (error)\nthree\nfour");

    await seekTo(page, when("six"));
    expect(await terminalText(page)).toBe("one\ntwo (error)\nthree\nfour\nfive (error)\nsix");
  });

  test("renders the ANSI colors that console.log adds to an object", async () => {
    await seekTo(page, chunks.at(-1)!.elapse);
    expect(await terminalText(page)).toContain("{\n  count: 7,\n}");
    const color = await page.evaluate<string>(`(() => {
      const span = [...document.querySelectorAll("#term span")].find((e) => e.textContent === "7");
      return getComputedStyle(span).color;
    })()`);
    expect(color).toBe("rgb(229, 229, 16)"); // ANSI yellow, which Bun uses for numbers
  });

  test("the time bar spans the recording, up to its last chunk", async () => {
    const last = chunks.at(-1)!.elapse;
    expect(Number(await page.getAttribute("#seek", "max"))).toBe(last);

    await seekTo(page, last);
    const seconds = (last / 1000).toFixed(3);
    expect(await page.innerText("#time")).toBe(`${seconds} / ${seconds} s`);
  });
});
