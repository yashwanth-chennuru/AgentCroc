import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";

export type TransferMode = "store" | "live";

export interface Config {
  agentmailApiKey: string;
  inboxId: string;
  downloadDir: string;
  crocBin: string;
  crocRelay?: string;
  crocPass?: string;
  crocStoreUrl: string;
  defaultMode: TransferMode;
  liveTimeoutMs: number;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and set your AgentMail credentials.`,
    );
  }
  return value;
}

export function loadConfig(): Config {
  const downloadDir = path.resolve(
    process.env.AGENTCROC_DOWNLOAD_DIR?.trim() || "./downloads",
  );
  const mode = (process.env.AGENTCROC_DEFAULT_MODE?.trim() || "store") as TransferMode;
  if (mode !== "store" && mode !== "live") {
    throw new Error(`AGENTCROC_DEFAULT_MODE must be "store" or "live", got: ${mode}`);
  }

  const crocBin = process.env.CROC_BIN?.trim() || "croc";

  return {
    agentmailApiKey: required("AGENTMAIL_API_KEY"),
    inboxId: required("AGENTCROC_INBOX_ID"),
    downloadDir,
    crocBin,
    crocRelay: process.env.CROC_RELAY?.trim() || undefined,
    crocPass: process.env.CROC_PASS?.trim() || undefined,
    crocStoreUrl: process.env.CROC_STORE_URL?.trim() || "https://getcroc.com",
    defaultMode: mode,
    liveTimeoutMs: Number(process.env.AGENTCROC_LIVE_TIMEOUT_MS || 15 * 60 * 1000),
  };
}

export function assertPathExists(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`Path does not exist: ${resolved}`);
  }
  return resolved;
}
