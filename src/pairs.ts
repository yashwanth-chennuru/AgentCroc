import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export interface PairRecord {
  secret: string;
  created_at: string;
}

export type PairsFile = Record<string, PairRecord>;

export function normalizeAgentEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function defaultPairsPath(): string {
  const home = process.env.HOME || process.cwd();
  return path.join(home, ".config", "agentcroc", "pairs.json");
}

export function resolvePairsPath(explicit?: string): string {
  return path.resolve(explicit || process.env.AGENTCROC_PAIRS_FILE || defaultPairsPath());
}

function readPairs(filePath: string): PairsFile {
  if (!existsSync(filePath)) return {};
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as PairsFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error(`Could not read pairs file: ${filePath}`);
  }
}

function writePairs(filePath: string, pairs: PairsFile): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(pairs, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function generatePairSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function getPairSecret(filePath: string, peerEmail: string): string | undefined {
  const key = normalizeAgentEmail(peerEmail);
  return readPairs(filePath)[key]?.secret;
}

export function listPairs(filePath: string): Array<{ peer: string; created_at: string }> {
  const pairs = readPairs(filePath);
  return Object.entries(pairs).map(([peer, rec]) => ({
    peer,
    created_at: rec.created_at,
  }));
}

export function upsertPair(
  filePath: string,
  peerEmail: string,
  secret: string,
): PairRecord {
  const key = normalizeAgentEmail(peerEmail);
  const cleaned = secret.trim();
  if (cleaned.length < 16) {
    throw new Error("Pair secret must be at least 16 characters");
  }
  const pairs = readPairs(filePath);
  const record: PairRecord = {
    secret: cleaned,
    created_at: pairs[key]?.created_at || new Date().toISOString(),
  };
  pairs[key] = record;
  writePairs(filePath, pairs);
  return record;
}

export function removePair(filePath: string, peerEmail: string): boolean {
  const key = normalizeAgentEmail(peerEmail);
  const pairs = readPairs(filePath);
  if (!pairs[key]) return false;
  delete pairs[key];
  writePairs(filePath, pairs);
  return true;
}
