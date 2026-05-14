import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createIsolatedCliEnvironment,
  runBuiltCli,
} from "./built-cli-harness.js";

const hosts = ["vscode", "opencode", "cursor", "zed", "claude-code", "pi"];

const tempRoot = await mkdtemp(join(tmpdir(), "agent-harness-cli-smoke-"));
try {
  const { workspaceRoot, env } = await createIsolatedCliEnvironment(tempRoot);

  await runBuiltCli({ cwd: workspaceRoot, env, args: ["setup", "hosts"] });
  await runBuiltCli({
    cwd: workspaceRoot,
    env,
    args: ["setup", "login", "--provider", "github"],
  });
  await runBuiltCli({
    cwd: workspaceRoot,
    env,
    args: ["install", "native", "--host", "vscode"],
  });
  await runBuiltCli({
    cwd: workspaceRoot,
    env,
    args: ["install", "native", "--host", "cursor"],
  });
  await runBuiltCli({ cwd: workspaceRoot, env, args: ["discover", "enrich"] });

  for (const host of hosts) {
    await runBuiltCli({
      cwd: workspaceRoot,
      env,
      args: ["wire", host, "--preview"],
    });
    await runBuiltCli({
      cwd: workspaceRoot,
      env,
      args: ["wire", host, "--apply"],
    });
    await runBuiltCli({
      cwd: workspaceRoot,
      env,
      args: ["wire", host, "--reset"],
    });
  }

  console.log(`CLI smoke completed with isolated workspace ${workspaceRoot}`);
} finally {
  await rm(tempRoot, { force: true, recursive: true });
}
