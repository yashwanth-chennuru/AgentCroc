import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import type { Config } from "./config.js";

export interface StoreSendResult {
  mode: "store";
  storeToken: string;
  browserLink?: string;
  revokeId?: string;
  expiresAt?: string;
  rawOutput: string;
}

export interface LiveSendHandle {
  mode: "live";
  code: string;
  done: Promise<void>;
  kill: () => void;
}

function relayArgs(config: Config): string[] {
  const args: string[] = [];
  if (config.crocRelay) {
    args.push("--relay", config.crocRelay);
  }
  if (config.crocPass) {
    args.push("--pass", config.crocPass);
  }
  return args;
}

function runCroc(
  config: Config,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    cwd?: string;
  } = {},
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.crocBin, args, {
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    let timedOut = false;
    const timer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, options.timeoutMs)
        : undefined;

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(
        new Error(
          `Failed to run croc (${config.crocBin}): ${err.message}. Is croc installed and on PATH?`,
        ),
      );
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`croc timed out after ${options.timeoutMs}ms`));
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}

export function fileSizeBytes(filePath: string): number {
  return statSync(filePath).size;
}

export function generateLiveCode(): string {
  // High-entropy machine secret; never shown to humans in normal MCP flow.
  return `ac-${randomBytes(18).toString("base64url")}`;
}

export function generateTransferId(): string {
  return `tr_${randomBytes(10).toString("hex")}`;
}

export async function crocStoreSend(
  config: Config,
  filePath: string,
): Promise<StoreSendResult> {
  const args = [
    ...relayArgs(config),
    "send",
    "--store",
    "--store-url",
    config.crocStoreUrl,
    filePath,
  ];

  const { stdout, stderr, code } = await runCroc(config, args, {
    timeoutMs: 10 * 60 * 1000,
  });
  const rawOutput = `${stdout}\n${stderr}`;
  if (code !== 0) {
    throw new Error(`croc store send failed (exit ${code}):\n${rawOutput}`);
  }

  const storeToken = rawOutput.match(/croc-store-v1\.[A-Za-z0-9._\-]+/)?.[0];
  if (!storeToken) {
    throw new Error(`Could not parse store token from croc output:\n${rawOutput}`);
  }

  const browserLink = rawOutput.match(/https:\/\/\S+\/s\/\S+/)?.[0];
  const revokeId = rawOutput.match(/croc --revoke\s+(\S+)/)?.[1];
  const expiresAt = rawOutput.match(/available until\s+(.+?)\s+or one verified/i)?.[1];

  return {
    mode: "store",
    storeToken,
    browserLink,
    revokeId,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    rawOutput,
  };
}

export function crocLiveSend(
  config: Config,
  filePath: string,
  code: string,
): LiveSendHandle {
  const args = [...relayArgs(config), "send", "--code", code, "--no-local", filePath];

  let child: ReturnType<typeof spawn> | undefined;
  const done = new Promise<void>((resolve, reject) => {
    child = spawn(config.crocBin, args, {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout?.on("data", (c: Buffer) => {
      output += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      output += c.toString();
    });

    const timer = setTimeout(() => {
      child?.kill("SIGTERM");
      reject(new Error(`Live send timed out after ${config.liveTimeoutMs}ms`));
    }, config.liveTimeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (exitCode === 0) resolve();
      else reject(new Error(`croc live send failed (exit ${exitCode}):\n${output}`));
    });
  });

  return {
    mode: "live",
    code,
    done,
    kill: () => child?.kill("SIGTERM"),
  };
}

export async function crocReceiveStore(
  config: Config,
  storeToken: string,
  outDir: string,
): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const args = [...relayArgs(config), "--yes", "--overwrite", "--out", outDir];
  const { stdout, stderr, code } = await runCroc(config, args, {
    env: { CROC_STORE_TOKEN: storeToken },
    timeoutMs: 10 * 60 * 1000,
    cwd: outDir,
  });
  const raw = `${stdout}\n${stderr}`;
  if (code !== 0) {
    throw new Error(`croc store receive failed (exit ${code}):\n${raw}`);
  }
  return path.resolve(outDir);
}

export async function crocReceiveLive(
  config: Config,
  code: string,
  outDir: string,
): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const args = [...relayArgs(config), "--yes", "--overwrite", "--out", outDir];
  const { stdout, stderr, exitCode } = await new Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }>((resolve, reject) => {
    const child = spawn(config.crocBin, args, {
      env: { ...process.env, CROC_SECRET: code },
      stdio: ["ignore", "pipe", "pipe"],
      cwd: outDir,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Live receive timed out after ${config.liveTimeoutMs}ms`));
    }, config.liveTimeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
  });

  const raw = `${stdout}\n${stderr}`;
  if (exitCode !== 0) {
    throw new Error(`croc live receive failed (exit ${exitCode}):\n${raw}`);
  }
  return path.resolve(outDir);
}
