import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export const SEAL_ALG = "agentcroc-seal/v1" as const;

export interface OfferSecrets {
  code?: string;
  store_token?: string;
  browser_link?: string;
  revoke_id?: string;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function deriveKey(sharedSecret: string, transferId: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(sharedSecret, "utf8"),
      Buffer.from(transferId, "utf8"),
      Buffer.from(SEAL_ALG, "utf8"),
      32,
    ),
  );
}

/** Encrypt offer secrets so AgentMail cannot redeem the transfer. */
export function sealSecrets(
  sharedSecret: string,
  transferId: string,
  secrets: OfferSecrets,
): string {
  const key = deriveKey(sharedSecret, transferId);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(secrets), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${b64url(iv)}.${b64url(ciphertext)}.${b64url(tag)}`;
}

export function unsealSecrets(
  sharedSecret: string,
  transferId: string,
  encryptedPayload: string,
): OfferSecrets {
  const parts = encryptedPayload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unsupported or corrupt sealed offer payload");
  }
  const [, ivB64, ctB64, tagB64] = parts;
  const key = deriveKey(sharedSecret, transferId);
  const decipher = createDecipheriv("aes-256-gcm", key, fromB64url(ivB64!));
  decipher.setAuthTag(fromB64url(tagB64!));
  const plaintext = Buffer.concat([
    decipher.update(fromB64url(ctB64!)),
    decipher.final(),
  ]);
  const parsed = JSON.parse(plaintext.toString("utf8")) as OfferSecrets;
  return parsed;
}
