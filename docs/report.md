# Report format

|         |            |
| ------- | ---------- |
| Version | 1.0.0      |
| Date    | 2026-10-01 |
| smoking | 0.0.17     |

The report is what `smoking` produces for a run. `--json` prints it on stdout,
`--output <path>` saves it to a file, and `smoking play <report.json>` replays
the console output recorded in it.

## Report

```ts
type Report = {
  file: string;
  runtime: "bun" | "node";
  ok: boolean;
  summary: { total: number; passed: number; failed: number };
  cases: CaseResult[];
};
```

| Field     | Description                                         |
| --------- | --------------------------------------------------- |
| `file`    | Absolute path of the `.donly` manifest that was run |
| `runtime` | Executable that ran the scripts (`--runtime`)       |
| `ok`      | `true` when no case failed                          |
| `summary` | Number of cases in total, passed and failed         |
| `cases`   | One entry per case, in manifest order               |

## Case

```ts
type CaseResult = {
  name: string;
  ok: boolean;
  error?: string;
  cast?: Capture;
  profiles?: ScriptProfile[];
  network?: NetworkRequest[];
};
```

| Field      | Description                                                           |
| ---------- | --------------------------------------------------------------------- |
| `name`     | Name of the case                                                      |
| `ok`       | `true` when the case passed                                           |
| `error`    | Error message. Only present on failed cases                           |
| `cast`     | Console output of the case's scripts. Left out with `--no-cast`       |
| `network`  | HTTP requests the case's scripts made. Only present with `--network`  |
| `profiles` | CPU profile of each script the case ran. Left out with `--no-profile` |

## Profile

```ts
type ScriptProfile = {
  phase: "setup" | "run" | "teardown";
  script: string;
  profile: unknown;
};
```

| Field     | Description                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `phase`   | Which script of the case was profiled                                                                                    |
| `script`  | Path of the script as it was run                                                                                         |
| `profile` | V8 CPU profile (`.cpuprofile`) written by `bun`/`node --cpu-prof`; open it in Chrome DevTools or speedscope as a `.json` |

## Network

```ts
type NetworkRequest = {
  phase: "setup" | "run" | "teardown";
  script: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  postData?: string;
  startedAt?: number;
  duration?: number;
  status?: number;
  statusText?: string;
  mimeType?: string;
  responseHeaders?: Record<string, string>;
  error?: string;
};
```

| Field                                                 | Description                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `phase`, `script`                                     | Which script of the case made the request (as in `profiles`)                 |
| `method`, `url`                                       | The request                                                                  |
| `requestHeaders`                                      | Request headers                                                              |
| `postData`                                            | Request body. Only with `--runtime bun`: Node's inspector does not report it |
| `startedAt`                                           | Epoch ms when the request started                                            |
| `duration`                                            | Ms from the start of the request until the response finished                 |
| `status`, `statusText`, `mimeType`, `responseHeaders` | The response, when there was one                                             |
| `error`                                               | Failure message, when the request failed                                     |

With `--runtime node` the requests come from `node:inspector` (its `Network`
domain, so `http`, `https` and `fetch`); Bun has no such domain, so with
`--runtime bun` `fetch` is wrapped and only `fetch` calls are recorded.

## Cast

```ts
type Capture = {
  startAt: number;
  chunks: { elapse: number; stream: "stdout" | "stderr"; buffer: number[] }[];
};
```

| Field             | Description                                         |
| ----------------- | --------------------------------------------------- |
| `startAt`         | Epoch milliseconds when the capture started         |
| `chunks[].elapse` | Milliseconds since `startAt` when the chunk arrived |
| `chunks[].stream` | Stream the chunk was written to                     |
| `chunks[].buffer` | Raw bytes of the chunk, one number (0-255) per byte |

## Example

```json
{
  "file": "/path/to/examples/basic.donly",
  "runtime": "bun",
  "ok": false,
  "summary": { "total": 2, "passed": 1, "failed": 1 },
  "cases": [
    {
      "name": "a",
      "ok": true,
      "cast": {
        "startAt": 1790000000000,
        "chunks": [{ "elapse": 12.5, "stream": "stdout", "buffer": [104, 105, 10] }]
      }
    },
    { "name": "b", "ok": false, "error": "..." }
  ]
}
```

## Versioning

The format is versioned as `MAJOR.MINOR.PATCH` with the date of the change. A
new field is a minor change; removing or renaming a field, or changing its
meaning, is a major one. Add a line to the changelog with every change.

## Changelog

| Version | Date       | Change                                                                             |
| ------- | ---------- | ---------------------------------------------------------------------------------- |
| 1.0.0   | 2026-10-01 | First documented version: `file`, `runtime`, `ok`, `summary`, `cases` with `cast`  |
| 1.1.0   | 2026-10-01 | `profiles` on cases, recorded by default in a report, left out with `--no-profile` |
| 1.2.0   | 2026-10-01 | `network` on cases, recorded by default in a report, left out with `--no-network`  |
