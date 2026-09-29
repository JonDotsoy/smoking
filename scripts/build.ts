import { copyFile, rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });

// Bundles the CLI and its dependencies (donly) into a single file, so the
// published package needs no `dependencies`.
const build = await Bun.build({
  entrypoints: [join(root, "bin", "smoking.ts")],
  outdir: dist,
  naming: "smoking.ts",
  target: "bun",
});
if (!build.success) {
  for (const log of build.logs) console.error(log);
  process.exit(1);
}

const pkg = await Bun.file(join(root, "package.json")).json();
const distPkg = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  repository: pkg.repository,
  license: pkg.license,
  author: pkg.author,
  type: pkg.type,
  bin: { smoking: "smoking.ts" },
};
await Bun.write(join(dist, "package.json"), JSON.stringify(distPkg, null, 2) + "\n");

for (const file of ["README.md", "LICENSE"]) {
  await copyFile(join(root, file), join(dist, file));
}

console.log(`Built ${pkg.name}@${pkg.version} in dist/`);
