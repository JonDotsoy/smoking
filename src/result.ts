export type Result<T> =
  | [ok: true, error: undefined, data: T]
  | [ok: false, error: unknown, data: undefined];

// Errors-as-values instead of try/catch:
//   const [ok, error, data] = await result(promise)
//   const [ok, error, data] = result(() => syncValue)
// A function that returns a promise is awaited, so it gives a Promise<Result>.
type ResultOf<R> = [R] extends [never]
  ? Result<never>
  : [R] extends [PromiseLike<infer U>]
    ? Promise<Result<U>>
    : Result<R>;

export function result<T>(promise: PromiseLike<T>): Promise<Result<T>>;
export function result<R>(fn: () => R): ResultOf<R>;
export function result<T>(
  source: PromiseLike<T> | (() => T | PromiseLike<T>),
): Result<T> | Promise<Result<T>> {
  const ok = (data: T): Result<T> => [true, undefined, data];
  const fail = (error: unknown): Result<T> => [false, error, undefined];

  if (typeof source !== "function") {
    return Promise.resolve(source).then(ok, fail);
  }

  let value: T | PromiseLike<T>;
  try {
    value = source();
  } catch (error) {
    return fail(error);
  }
  return isPromiseLike(value) ? Promise.resolve(value).then(ok, fail) : ok(value);
}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null | undefined)?.then === "function";
