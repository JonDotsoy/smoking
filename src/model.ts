import { access } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { result } from "./utils/result.ts";
import { parseSpec, type CaseSpec, type ScriptSpec, type Spec } from "./spec.ts";

// In-memory model of a `.donly` or YAML file: both formats are parsed into the
// same instances, so the rest of the code does not care which one it came from.

export type Syntax = "ts" | "tsx" | "js" | "jsx" | "mjs";

const SYNTAXES: readonly string[] = ["ts", "tsx", "js", "jsx", "mjs"];

const isSyntax = (value: string): value is Syntax => SYNTAXES.includes(value);

const encoder = new TextEncoder();

export class Script {
  readonly syntax: Syntax;
  // Source code, as bytes.
  readonly command: Uint8Array;
  // Only for scripts given as a path (`run ./x.ts`): where the file lives.
  readonly location?: URL;
  // Why the script cannot run (malformed directive, missing file); `command`
  // is empty then.
  readonly error?: string;

  constructor(init: { syntax: Syntax; command: Uint8Array; location?: URL; error?: string }) {
    this.syntax = init.syntax;
    this.command = init.command;
    this.location = init.location;
    this.error = init.error;
  }

  get text(): string {
    return new TextDecoder().decode(this.command);
  }
}

export class Case {
  readonly name?: string;
  // The file the case was declared in.
  readonly location: URL;
  readonly env: Readonly<Record<string, string>>;
  // Files or folders copied into the working directory (`add`): path relative
  // to the working directory -> where it lives.
  readonly adds: ReadonlyMap<string, URL>;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly setups: readonly Script[];
  readonly run?: Script;
  readonly teardowns: readonly Script[];
  // Why the case cannot run (malformed directive, missing script file); the
  // other fields are empty then.
  readonly error?: string;

  constructor(init: {
    name?: string;
    location: URL;
    env?: Record<string, string>;
    adds?: Map<string, URL>;
    files?: Map<string, Uint8Array>;
    setups?: Script[];
    run?: Script;
    teardowns?: Script[];
    error?: string;
  }) {
    this.name = init.name;
    this.location = init.location;
    this.env = init.env ?? {};
    this.adds = init.adds ?? new Map();
    this.files = init.files ?? new Map();
    this.setups = init.setups ?? [];
    this.run = init.run;
    this.teardowns = init.teardowns ?? [];
    this.error = init.error;
  }
}

export class SmokingFile {
  readonly location: URL;
  readonly dependencies: readonly string[];
  readonly cases: readonly Case[];

  constructor(init: { location: URL; dependencies?: string[]; cases?: Case[] }) {
    this.location = init.location;
    this.dependencies = init.dependencies ?? [];
    this.cases = init.cases ?? [];
  }

  // Parses `.donly` (or `.yaml`/`.yml`, by extension) text. `filePath` is the
  // file the text came from; `run ./x.ts` paths resolve against it. A
  // malformed case does not throw: it comes back with its `error` set.
  static async parse(filePath: string, text: string): Promise<SmokingFile> {
    const absolute = resolve(filePath);
    return buildFile(parseSpec(absolute, text), absolute);
  }

  static async fromFile(filePath: string): Promise<SmokingFile> {
    return SmokingFile.parse(filePath, await Bun.file(filePath).text());
  }
}

const buildScript = async (spec: ScriptSpec, kind: string, baseDir: string): Promise<Script> => {
  const [ok, error, script] = await result(buildValidScript(spec, kind, baseDir));
  if (ok) return script;
  const message = error instanceof Error ? error.message : String(error);
  return new Script({ syntax: "ts", command: new Uint8Array(), error: message });
};

const buildValidScript = async (
  spec: ScriptSpec,
  kind: string,
  baseDir: string,
): Promise<Script> => {
  if (spec.kind === "inline") {
    if (!isSyntax(spec.ext)) throw new Error(`unknown script syntax "${spec.ext}"`);
    return new Script({ syntax: spec.ext, command: encoder.encode(spec.code) });
  }
  if (spec.kind === "file") {
    const path = resolve(baseDir, spec.path);
    const ext = extname(path).slice(1).toLowerCase();
    if (!isSyntax(ext)) throw new Error(`unsupported script file: ${path}`);
    if (!(await Bun.file(path).exists())) throw new Error(`${kind} file not found: ${path}`);
    return new Script({
      syntax: ext,
      command: new Uint8Array(await Bun.file(path).arrayBuffer()),
      location: pathToFileURL(path),
    });
  }
  throw new Error(spec.message);
};

const buildCase = async (spec: CaseSpec, location: URL, baseDir: string): Promise<Case> => {
  const [ok, error, built] = await result(buildValidCase(spec, location, baseDir));
  if (ok) return built;
  const message = error instanceof Error ? error.message : String(error);
  return new Case({ name: spec.name, location, error: message });
};

const exists = async (path: string): Promise<boolean> => (await result(access(path)))[0];

// `add <path>`: a file or folder next to the spec file, copied keeping its
// relative path (`add src/` -> `<workDir>/src/`).
const buildAdds = async (spec: CaseSpec["adds"], baseDir: string): Promise<Map<string, URL>> => {
  const adds = new Map<string, URL>();
  for (const add of spec) {
    if (add.error !== undefined) throw new Error(add.error);
    const source = resolve(baseDir, add.path);
    const rel = relative(baseDir, source);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`\`add ${add.path}\` must point inside the spec file's folder`);
    }
    if (!(await exists(source))) throw new Error(`\`add\` path not found: ${source}`);
    adds.set(rel, pathToFileURL(source));
  }
  return adds;
};

const buildValidCase = async (spec: CaseSpec, location: URL, baseDir: string): Promise<Case> => {
  const adds = await buildAdds(spec.adds, baseDir);
  const files = new Map<string, Uint8Array>();
  for (const file of spec.files) {
    if (file.error !== undefined || file.content === undefined) throw new Error(file.error);
    files.set(file.path, encoder.encode(file.content));
  }
  return new Case({
    name: spec.name,
    location,
    env: Object.fromEntries(spec.env),
    adds,
    files,
    setups: await Promise.all(spec.setups.map((s) => buildScript(s, "setup", baseDir))),
    run: spec.run && (await buildScript(spec.run, "run", baseDir)),
    teardowns: await Promise.all(spec.teardowns.map((s) => buildScript(s, "teardown", baseDir))),
  });
};

const buildFile = async (spec: Spec, filePath: string): Promise<SmokingFile> => {
  const location = pathToFileURL(filePath);
  const baseDir = dirname(filePath);
  return new SmokingFile({
    location,
    dependencies: spec.dependencies,
    cases: await Promise.all(spec.cases.map((c) => buildCase(c, location, baseDir))),
  });
};
