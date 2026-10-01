- [x] Add `docs/player.html`: standalone page that replays a report's cast in a terminal with a time bar
- [x] Document it in the README

## Context

- The emulator maps LF to CRLF because the recorded bytes come from a pipe, not a TTY.
- Verified in Chromium with a real report and a synthetic cast (colors, `\r`, stderr, UTF-8).
