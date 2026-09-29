import { DON, Directive, HeredocValue, ROOT_DIRECTIVE_NAME } from "donly";
import { extname } from "node:path";

export type ScriptSpec =
  | { kind: "inline"; code: string; ext: string }
  | { kind: "file"; path: string }
  | { kind: "invalid"; message: string };

export type CaseSpec = {
  name?: string;
  env: [name: string, value: string][];
  files: { path: string; content?: string; error?: string }[];
  setups: ScriptSpec[];
  run?: ScriptSpec;
  teardowns: ScriptSpec[];
};

export type Spec = {
  dependencies: string[];
  cases: CaseSpec[];
};

const EXT_BY_DELIMITER: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "mjs",
};

export const YAML_EXTENSIONS = [".yaml", ".yml"];

export const isYamlFile = (filePath: string): boolean =>
  YAML_EXTENSIONS.includes(extname(filePath).toLowerCase());

const argValue = (arg: Directive["args"][number]): string =>
  arg instanceof HeredocValue ? arg.content : String(arg);

const directivesNamed = (directive: Directive, name: string): Directive[] =>
  directive.children.filter((child) => child.name === name);

// `DON.parse()` collapses a file with a single top-level directive into
// that directive itself, instead of wrapping it in a synthetic root — so a
// `.donly` file with just one `case` and no `dependency` has that `case` as
// `root` directly, not as a child of it.
const topLevelDirectives = (root: Directive): Directive[] =>
  root.name === ROOT_DIRECTIVE_NAME ? root.children : [root];

const donScript = (directive: Directive, kind: string): ScriptSpec => {
  const source = directive.args[0];
  if (source instanceof HeredocValue) {
    return {
      kind: "inline",
      code: source.content,
      ext: EXT_BY_DELIMITER[source.delimiter?.toLowerCase() ?? ""] ?? "ts",
    };
  }
  if (typeof source === "string" && source) return { kind: "file", path: source };
  return {
    kind: "invalid",
    message: `\`${kind}\` directive expects a heredoc body or a file path`,
  };
};

const donCase = (caseDirective: Directive): CaseSpec => ({
  name: caseDirective.args.length ? caseDirective.args.map(argValue).join(" ") : undefined,
  env: directivesNamed(caseDirective, "env").map((d) => {
    const [name, value] = d.args.map(argValue);
    return [name ?? "", value ?? ""];
  }),
  files: directivesNamed(caseDirective, "file").map((d) => {
    const [path, content] = d.args;
    if (typeof path !== "string" || !path) {
      return { path: "", error: "`file` directive expects a path as its first argument" };
    }
    if (!(content instanceof HeredocValue)) {
      return { path, error: `\`file ${path}\` expects a heredoc body` };
    }
    return { path, content: content.content };
  }),
  setups: directivesNamed(caseDirective, "setup").map((d) => donScript(d, "setup")),
  run: directivesNamed(caseDirective, "run").map((d) => donScript(d, "run"))[0],
  teardowns: directivesNamed(caseDirective, "teardown").map((d) => donScript(d, "teardown")),
});

export const parseDon = (text: string): Spec => {
  const topLevel = topLevelDirectives(DON.parse(text));
  return {
    dependencies: topLevel
      .filter((d) => d.name === "dependency")
      .map((d) => d.args.map(argValue).join("")),
    cases: topLevel.filter((d) => d.name === "case").map(donCase),
  };
};

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const list = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

// A script is a string (inline TypeScript), `{ file: path }` or
// `{ code, lang }`.
const yamlScript = (value: unknown, kind: string): ScriptSpec => {
  if (typeof value === "string") return { kind: "inline", code: value, ext: "ts" };
  if (isObj(value)) {
    if (typeof value.file === "string" && value.file) return { kind: "file", path: value.file };
    if (typeof value.code === "string") {
      const lang = String(value.lang ?? "ts").toLowerCase();
      const ext = EXT_BY_DELIMITER[lang];
      if (!ext) return { kind: "invalid", message: `unknown \`lang\` "${lang}" in \`${kind}\`` };
      return { kind: "inline", code: value.code, ext };
    }
  }
  return {
    kind: "invalid",
    message: `\`${kind}\` expects a code string, \`{ file: <path> }\` or \`{ code, lang }\``,
  };
};

const yamlCase = (value: unknown): CaseSpec => {
  const c: Obj = isObj(value) ? value : {};
  const env = isObj(c.env) ? Object.entries(c.env) : [];
  const files = isObj(c.files) ? Object.entries(c.files) : [];
  return {
    name: c.name === undefined ? undefined : String(c.name),
    env: env.map(([name, v]) => [name, String(v ?? "")]),
    files: files.map(([path, content]) =>
      typeof content === "string"
        ? { path, content }
        : { path, error: `\`files.${path}\` expects a string body` },
    ),
    setups: list(c.setup).map((s) => yamlScript(s, "setup")),
    run: c.run === undefined ? undefined : yamlScript(c.run, "run"),
    teardowns: list(c.teardown).map((s) => yamlScript(s, "teardown")),
  };
};

// Shape: `dependencies: [pkg, ...]` and `cases: [{ name, env, files, setup,
// run, teardown }, ...]` — the same concepts as the .donly directives.
export const parseYaml = (text: string): Spec => {
  const doc: unknown = Bun.YAML.parse(text);
  if (doc !== null && doc !== undefined && !isObj(doc)) {
    throw new Error("YAML file must be a mapping with `dependencies` and `cases`");
  }
  const root: Obj = doc ?? {};
  return {
    dependencies: list(root.dependencies).map(String),
    cases: list(root.cases).map(yamlCase),
  };
};

export const parseSpec = (filePath: string, text: string): Spec =>
  isYamlFile(filePath) ? parseYaml(text) : parseDon(text);
