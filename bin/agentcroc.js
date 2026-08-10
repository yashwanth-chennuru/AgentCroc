#!/usr/bin/env node
/**
 * Thin launcher so `npx` / MCP configs stay simple.
 * Ensures `croc` is available, then starts the MCP server.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function crocOnPath() {
  const result = spawnSync("croc", ["-v"], { encoding: "utf8" });
  return result.status === 0;
}

if (!crocOnPath()) {
  console.error(`
AgentCroc needs the croc CLI (file transfer engine).

Install once:
  curl https://getcroc.com | bash

Or: https://github.com/schollz/croc#install
`);
  process.exit(1);
}

const distEntry = path.join(__dirname, "..", "dist", "index.js");
const srcEntry = path.join(__dirname, "..", "src", "index.ts");

let args;
if (existsSync(distEntry)) {
  args = [distEntry];
} else {
  const tsxCli = require.resolve("tsx/cli");
  args = [tsxCli, srcEntry];
}

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
