import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RUNTIMES, type Runtime } from "./run-file.ts";

export type CliMainArgsResult = {
  dependencies: string[];
  runtime: Runtime;
  file: URL;
  json: boolean;
  // Record each case's console output byte by byte into the report: on when
  // a report is requested (--json or --output), off with --no-cast.
  capture: boolean;
  // Record a CPU profile of each script into the report (--profile).
  profile: boolean;
  // Where the JSON report is saved, when --output was given.
  output?: URL;
};

// `help`: --help/-h was given. `missing-file`: no .donly file was given.
// `invalid`: a bad or unknown option (the message says which).
export class CliArgsError extends Error {
  constructor(
    message: string,
    readonly kind: "help" | "missing-file" | "invalid",
  ) {
    super(message);
    this.name = "CliArgsError";
  }
}

export class CliMainArgs {
  parse(args: string[]): CliMainArgsResult {
    if (args.includes("-h") || args.includes("--help")) {
      throw new CliArgsError("help requested", "help");
    }

    const dependencies: string[] = [];
    const positional: string[] = [];
    let runtime: Runtime = "bun";
    let json = false;
    let noCast = false;
    let profile = false;
    let output: URL | undefined;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      const [name, inlineValue] = this.splitOption(arg);
      const value = () => this.optionValue(name, inlineValue, () => args[++i]);

      if (name === "--dependency") {
        dependencies.push(value());
      } else if (name === "--runtime") {
        runtime = this.parseRuntime(value());
      } else if (name === "--json") {
        if (inlineValue !== undefined) {
          throw new CliArgsError("Option --json does not take a value", "invalid");
        }
        json = true;
      } else if (name === "--no-cast") {
        if (inlineValue !== undefined) {
          throw new CliArgsError("Option --no-cast does not take a value", "invalid");
        }
        noCast = true;
      } else if (name === "--profile") {
        if (inlineValue !== undefined) {
          throw new CliArgsError("Option --profile does not take a value", "invalid");
        }
        profile = true;
      } else if (name === "--output") {
        output = pathToFileURL(resolve(value()));
      } else if (arg.startsWith("-")) {
        throw new CliArgsError(`Unknown option: ${arg}`, "invalid");
      } else {
        positional.push(arg);
      }
    }

    const file = positional[0];
    if (!file) throw new CliArgsError("missing .donly file", "missing-file");

    return {
      dependencies,
      runtime,
      file: pathToFileURL(resolve(file)),
      json,
      // The cast only exists in a report, so it needs --json or --output.
      // Like the cast, profiles only exist in a report.
      profile: profile && (json || output !== undefined),
      capture: !noCast && (json || output !== undefined),
      ...(output === undefined ? {} : { output }),
    };
  }

  private splitOption(arg: string): [name: string, inlineValue: string | undefined] {
    if (!arg.startsWith("--")) return [arg, undefined];
    const eq = arg.indexOf("=");
    return eq === -1 ? [arg, undefined] : [arg.slice(0, eq), arg.slice(eq + 1)];
  }

  private optionValue(
    name: string,
    inlineValue: string | undefined,
    next: () => string | undefined,
  ): string {
    const value = inlineValue ?? next();
    if (!value || value.startsWith("-")) {
      throw new CliArgsError(`Option ${name} requires a value`, "invalid");
    }
    return value;
  }

  private parseRuntime(value: string): Runtime {
    if (!RUNTIMES.includes(value as Runtime)) {
      throw new CliArgsError(
        `Invalid --runtime "${value}": expected ${RUNTIMES.join(" or ")}`,
        "invalid",
      );
    }
    return value as Runtime;
  }
}
