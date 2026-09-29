import { describe, expect, test } from "bun:test";
import { result } from "../src/result.ts";

describe("result()", () => {
  test("resolved promise -> [true, undefined, data]", async () => {
    expect(await result(Promise.resolve(42))).toEqual([true, undefined, 42]);
  });

  test("rejected promise -> [false, error, undefined]", async () => {
    const boom = new Error("boom");

    expect(await result(Promise.reject(boom))).toEqual([false, boom, undefined]);
  });

  test("sync function -> a tuple, not a promise", () => {
    const value = result(() => "sync");

    expect(value).toEqual([true, undefined, "sync"]);
  });

  test("throwing sync function -> [false, error, undefined]", () => {
    const boom = new Error("boom");

    expect(
      result(() => {
        throw boom;
      }),
    ).toEqual([false, boom, undefined]);
  });

  test("async function -> awaited into a tuple", async () => {
    expect(await result(async () => 1)).toEqual([true, undefined, 1]);
    const boom = new Error("async boom");
    expect(
      await result(async () => {
        throw boom;
      }),
    ).toEqual([false, boom, undefined]);
  });

  test("narrows data and error through `ok`", async () => {
    const [ok, error, data] = await result(Promise.resolve({ n: 1 }));

    if (ok) {
      expect(data.n).toBe(1);
      expect(error).toBeUndefined();
    } else {
      throw new Error("unreachable");
    }
  });

  test("keeps falsy thrown and returned values", () => {
    expect(result(() => 0)).toEqual([true, undefined, 0]);
    expect(
      result(() => {
        throw undefined;
      }),
    ).toEqual([false, undefined, undefined]);
  });
});
