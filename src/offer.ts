import { SEAL_ALG, sealSecrets, unsealSecrets, type OfferSecrets } from "./seal.js";

export const OFFER_SUBJECT_PREFIX = "[AgentCroc]";
export const OFFER_BEGIN = "AGENTCROC_OFFER_BEGIN";
export const OFFER_END = "AGENTCROC_OFFER_END";
export const OFFER_PROTOCOL = "agentcroc-offer/v1";
export const RECEIVED_LABEL = "agentcroc-received";

export type OfferMode = "store" | "live";

export interface FileOffer {
  protocol: typeof OFFER_PROTOCOL;
  transfer_id: string;
  from: string;
  to: string;
  filename: string;
  size_bytes: number;
  mode: OfferMode;
  /** croc PAKE code for live mode (plaintext offers only) */
  code?: string;
  /** croc-store-v1... token for store mode (plaintext offers only) */
  store_token?: string;
  /** browser link for humans / debugging (plaintext offers only) */
  browser_link?: string;
  /** store transfer id for revoke (plaintext offers only) */
  revoke_id?: string;
  relay?: string;
  store_url?: string;
  created_at: string;
  expires_at: string;
  /** When true, redeem secrets are in encrypted_payload */
  sealed?: boolean;
  seal_alg?: typeof SEAL_ALG;
  encrypted_payload?: string;
}

export function isFileOffer(value: unknown): value is FileOffer {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  const base =
    o.protocol === OFFER_PROTOCOL &&
    typeof o.transfer_id === "string" &&
    typeof o.from === "string" &&
    typeof o.to === "string" &&
    typeof o.filename === "string" &&
    typeof o.mode === "string" &&
    (o.mode === "store" || o.mode === "live");
  if (!base) return false;
  if (o.sealed === true) {
    return typeof o.encrypted_payload === "string" && o.encrypted_payload.length > 0;
  }
  return true;
}

export function extractSecrets(offer: FileOffer): OfferSecrets {
  return {
    code: offer.code,
    store_token: offer.store_token,
    browser_link: offer.browser_link,
    revoke_id: offer.revoke_id,
  };
}

/** Strip redeem secrets and attach AES-GCM sealed payload for AgentMail. */
export function sealOfferForMailbox(offer: FileOffer, sharedSecret: string): FileOffer {
  const secrets = extractSecrets(offer);
  const encrypted_payload = sealSecrets(sharedSecret, offer.transfer_id, secrets);
  return {
    protocol: offer.protocol,
    transfer_id: offer.transfer_id,
    from: offer.from,
    to: offer.to,
    filename: offer.filename,
    size_bytes: offer.size_bytes,
    mode: offer.mode,
    relay: offer.relay,
    store_url: offer.store_url,
    created_at: offer.created_at,
    expires_at: offer.expires_at,
    sealed: true,
    seal_alg: SEAL_ALG,
    encrypted_payload,
  };
}

/** Restore redeem secrets locally after reading a sealed (or plaintext) offer. */
export function openOfferSecrets(offer: FileOffer, sharedSecret?: string): FileOffer {
  if (!offer.sealed) return offer;
  if (!sharedSecret) {
    throw new Error(
      `Offer ${offer.transfer_id} is sealed. Pair with ${offer.from} first (pair_accept), then retry receive_file.`,
    );
  }
  if (!offer.encrypted_payload) {
    throw new Error(`Sealed offer ${offer.transfer_id} is missing encrypted_payload`);
  }
  const secrets = unsealSecrets(sharedSecret, offer.transfer_id, offer.encrypted_payload);
  return {
    ...offer,
    ...secrets,
  };
}

export function serializeOffer(offer: FileOffer): { subject: string; text: string } {
  const subject = `${OFFER_SUBJECT_PREFIX} offer ${offer.transfer_id} :: ${offer.filename}`;
  const sealedNote = offer.sealed
    ? `This offer is sealed with a paired shared secret. Redeem tokens are encrypted.`
    : `This offer includes redeem material in plaintext (no pair configured).`;
  const text = [
    `AgentCroc file transfer offer`,
    ``,
    `From: ${offer.from}`,
    `To: ${offer.to}`,
    `File: ${offer.filename}`,
    `Mode: ${offer.mode}`,
    `Transfer ID: ${offer.transfer_id}`,
    `Expires: ${offer.expires_at}`,
    `Sealed: ${offer.sealed ? "yes" : "no"}`,
    ``,
    `This message is a pickup slip only — the file bytes are NOT attached.`,
    sealedNote,
    `Your AgentCroc MCP will parse the block below to fetch & decrypt the file.`,
    ``,
    OFFER_BEGIN,
    JSON.stringify(offer, null, 2),
    OFFER_END,
    ``,
  ].join("\n");
  return { subject, text };
}

export function parseOfferFromText(text: string | null | undefined): FileOffer | null {
  if (!text) return null;
  const begin = text.indexOf(OFFER_BEGIN);
  const end = text.indexOf(OFFER_END);
  if (begin === -1 || end === -1 || end <= begin) return null;
  const json = text.slice(begin + OFFER_BEGIN.length, end).trim();
  try {
    const parsed: unknown = JSON.parse(json);
    return isFileOffer(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function offerIsExpired(offer: FileOffer, now = new Date()): boolean {
  const expires = Date.parse(offer.expires_at);
  if (Number.isNaN(expires)) return false;
  return now.getTime() > expires;
}
