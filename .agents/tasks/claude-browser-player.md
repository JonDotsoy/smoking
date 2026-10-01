- [x] Add `docs/player.html`: standalone page that replays a report's cast in a terminal with a time bar
- [x] Document it in the README

## Context

- The emulator maps LF to CRLF because the recorded bytes come from a pipe, not a TTY.
- Verified in Chromium with a real report and a synthetic cast (colors, `\r`, stderr, UTF-8).

- [x] Add `smoking play --ui <report>`: serve the player and the report on localhost (`src/play-ui.ts`), help, README and tests

- [x] Browser test for `play --ui` with Playwright (`test/play-ui.browser.test.ts`; skipped without Chromium)

- [x] Browser test that records a real script (several console.log/console.error) and plays it
