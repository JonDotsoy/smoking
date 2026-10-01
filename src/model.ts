import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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

  constructor(init: { syntax: Syntax; command: Uint8Array; location?: URL }) {
    this.syntax = init.syntax;
    this.command = init.command;
    this.location = init.location;
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
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly setups: readonly Script[];
  readonly run?: Script;
  readonly teardowns: readonly Script[];

  constructor(init: {
    name?: string;
    location: URL;
    env?: Record<string, string>;
    files?: Map<string, Uint8Array>;
    setups?: Script[];
    run?: Script;
    teardowns?: Script[];
  }) {
    this.name = init.name;
    this.location = init.location;
    this.env = init.env ?? {};
    this.files = init.files ?? new Map();
    this.setups = init.setups ?? [];
    this.run = init.run;
    this.teardowns = init.teardowns ?? [];
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
  // file the text came from; `run ./x.ts` paths resolve against it. Throws if
  // the spec is malformed.
  static async parse(filePath: string, text: string): Promise<SmokingFile> {
    const absolute = resolve(filePath);
    return buildFile(parseSpec(absolute, text), absolute);
  }

  static async fromFile(filePath: string): Promise<SmokingFile> {
    return SmokingFile.parse(filePath, await Bun.file(filePath).text());
  }
}

const buildScript = async (spec: ScriptSpec, baseDir: string): Promise<Script> => {
  if (spec.kind === "inline") {
    if (!isSyntax(spec.ext)) throw new Error(`unknown script syntax "${spec.ext}"`);
    return new Script({ syntax: spec.ext, command: encoder.encode(spec.code) });
  }
  if (spec.kind === "file") {
    const path = resolve(baseDir, spec.path);
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    if (!isSyntax(ext)) throw new Error(`unsupported script file: ${path}`);
    return new Script({
      syntax: ext,
      command: new Uint8Array(await Bun.file(path).arrayBuffer()),
      location: pathToFileURL(path),
    });
  }
  throw new Error(spec.message);
};

const buildCase = async (spec: CaseSpec, location: URL, baseDir: string): Promise<Case> => {
  const files = new Map<string, Uint8Array>();
  for (const file of spec.files) {
    if (file.error !== undefined || file.content === undefined) throw new Error(file.error);
    files.set(file.path, encoder.encode(file.content));
  }
  return new Case({
    name: spec.name,
    location,
    env: Object.fromEntries(spec.env),
    files,
    setups: await Promise.all(spec.setups.map((s) => buildScript(s, baseDir))),
    run: spec.run && (await buildScript(spec.run, baseDir)),
    teardowns: await Promise.all(spec.teardowns.map((s) => buildScript(s, baseDir))),
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
