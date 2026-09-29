
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Error handling: `result()`

Don't write `try/catch` (or `try/finally`) in `src/`, `bin/` or tests. Use the
`result()` utility from `src/utils/result.ts`, which returns errors as values:

```ts
import { result } from "./utils/result.ts";

// Promise (or async function): await it
const [ok, error, data] = await result(promise);
const [ok, error, data] = await result(async () => readThing());

// Synchronous function: no await, you get the tuple directly
const [ok, error, data] = result(() => JSON.parse(text));
```

- The tuple is `[true, undefined, data]` on success and
  `[false, error, undefined]` on failure. Check `ok` first; TypeScript narrows
  `data` and `error` from it.
- `error` is `unknown`: narrow it (`error instanceof Error`) before reading it.
- Never rely on `data` being truthy to detect success; `0`, `""` and `false`
  are valid data. Always check `ok`.
- `result()` never throws. To propagate, rethrow explicitly: `if (!ok) throw error;`.
- Cleanup that used to be `finally` runs after the call, then rethrows:

```ts
const [ok, error, value] = await result(doWork(dir));
await rm(dir, { recursive: true, force: true });
if (!ok) throw error;
```

## Testing

Use `bun test` to run tests, and `bun run typecheck` (`tsc --noEmit`) to check
types. Type-level tests use `expectTypeOf` from `bun:test` (see
`test/utils/result.types.test.ts`); they are only enforced by `typecheck`, not
by `bun test`.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
