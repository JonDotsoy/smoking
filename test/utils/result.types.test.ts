import { describe, expect, expectTypeOf, test } from "bun:test";
import { result } from "../../src/utils/result.ts";

// `expectTypeOf` only exists at the type level: these checks are enforced by
// `bun run check` (tsc). `bun test` still runs the runtime assertions.
describe("result() types", () => {
  test("a function returning a value: data is string | undefined until `ok` is checked", async () => {
    const [ok, error, data] = await result(() => "ok");

    expectTypeOf(ok).toEqualTypeOf<boolean>();
    expectTypeOf(data).toEqualTypeOf<string | undefined>();
    if (ok) {
      expectTypeOf(data).toEqualTypeOf<string>();
      expectTypeOf(error).toEqualTypeOf<undefined>();
      expect(data).toBe("ok");
    } else {
      expectTypeOf(data).toEqualTypeOf<undefined>();
      expectTypeOf(error).toEqualTypeOf<unknown>();
    }
  });

  test("sync functions return the tuple directly (no Promise)", () => {
    const value = result(() => 1);

    expectTypeOf(value).not.toExtend<Promise<unknown>>();
    expectTypeOf(value).toEqualTypeOf<
      [ok: true, error: undefined, data: number] | [ok: false, error: unknown, data: undefined]
    >();
  });

  test("promises and async functions return a Promise of the tuple", async () => {
    const fromPromise = result(Promise.resolve("a"));
    const fromAsyncFn = result(async () => 1);

    expectTypeOf(fromPromise).resolves.toEqualTypeOf<
      [ok: true, error: undefined, data: string] | [ok: false, error: unknown, data: undefined]
    >();
    expectTypeOf(fromAsyncFn).resolves.toEqualTypeOf<
      [ok: true, error: undefined, data: number] | [ok: false, error: unknown, data: undefined]
    >();

    const [ok, , data] = await fromAsyncFn;
    if (ok) expectTypeOf(data).toEqualTypeOf<number>();
  });

  test("error is unknown and data is undefined on failure", async () => {
    const [ok, error, data] = await result(Promise.reject(new Error("boom")) as Promise<string>);

    if (!ok) {
      expectTypeOf(error).toEqualTypeOf<unknown>();
      expectTypeOf(data).toEqualTypeOf<undefined>();
      expect(error).toBeInstanceOf(Error);
    }
  });
});
