import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { CLI_PATH, REPO_ROOT } from "./helpers.ts";

// Chromium: $SMOKING_CHROMIUM, the one Playwright installed, or the sandbox's.
// Without a browser these tests are skipped.
const chromiumPath = [
  process.env.SMOKING_CHROMIUM,
  chromium.executablePath(),
  "/opt/pw-browsers/chromium",
].find((path) => path && existsSync(path));

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

  const seek = (ms: number) =>
    page.evaluate((value) => {
      const input = document.getElementById("seek") as HTMLInputElement;
      input.value = String(value);
      input.dispatchEvent(new Event("input"));
    }, ms);
  const terminal = async () => (await page.innerText("#term")).replace(/[ \t]+$/gm, "").trimEnd();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "smoking-play-ui-"));
    const report = join(dir, "report.json");
    await writeFile(report, JSON.stringify(REPORT));

    server = Bun.spawn(["bun", CLI_PATH, "play", "--ui", report], {
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
    url = /Player at (\S+)/.exec(output)![1]!;

    browser = await chromium.launch({ executablePath: chromiumPath! });
    page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    await page.goto(url); // `/` redirects to `/?report=/report.json`
    await page.waitForSelector("#window:not([hidden])");
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
      page.locator("#term span", { hasText: text }).evaluate((e) => getComputedStyle(e).color);
    expect(await color("Build")).toBe("rgb(13, 188, 121)");
    expect(await color("warn: ñ")).toBe("rgb(205, 49, 49)");
  });

  test("plays from the start up to the end", async () => {
    await page.selectOption("#speed", "4");
    await seek(0);
    await page.click("#play");
    await page.waitForFunction(() =>
      document.getElementById("time")!.textContent!.startsWith("1.000"),
    );
    expect(await terminal()).toBe("Build starting\nprogress 100%\nwarn: ñ");
    await page.waitForFunction(() => document.getElementById("play")!.textContent === "▶");
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
