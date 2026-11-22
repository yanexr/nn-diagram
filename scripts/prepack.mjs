// Runs before `pnpm pack` / `pnpm publish` in each package folder: copies the
// license files (and, for the CLI, the agent skill) into the package.
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
for (const file of ["LICENSE", "NOTICE"]) cpSync(join(root, file), file);
if (existsSync("bin/nn-diagram.js")) cpSync(join(root, "skills", "nn-diagram"), "skill", { recursive: true });
