const { existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

if (!existsSync(".git")) {
  process.exit(0);
}

const huskyBin = join("node_modules", "husky", "bin.js");
if (!existsSync(huskyBin)) {
  process.exit(0);
}

execFileSync(process.execPath, [huskyBin], { stdio: "inherit" });
