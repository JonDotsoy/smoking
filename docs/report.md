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
};
```

| Field   | Description                                                     |
| ------- | --------------------------------------------------------------- |
| `name`  | Name of the case                                                |
| `ok`    | `true` when the case passed                                     |
| `error` | Error message. Only present on failed cases                     |
| `cast`  | Console output of the case's scripts. Left out with `--no-cast` |

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

| Version | Date       | Change                                                                            |
| ------- | ---------- | --------------------------------------------------------------------------------- |
| 1.0.0   | 2026-10-01 | First documented version: `file`, `runtime`, `ok`, `summary`, `cases` with `cast` |
