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
  /** croc PAKE code for live mode */
  code?: string;
  /** croc-store-v1... token for store mode */
  store_token?: string;
  /** browser link for humans / debugging */
  browser_link?: string;
  /** store transfer id for revoke */
  revoke_id?: string;
  relay?: string;
  store_url?: string;
  created_at: string;
  expires_at: string;
}

export function isFileOffer(value: unknown): value is FileOffer {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    o.protocol === OFFER_PROTOCOL &&
    typeof o.transfer_id === "string" &&
    typeof o.from === "string" &&
    typeof o.to === "string" &&
    typeof o.filename === "string" &&
    typeof o.mode === "string" &&
    (o.mode === "store" || o.mode === "live")
  );
}

export function serializeOffer(offer: FileOffer): { subject: string; text: string } {
  const subject = `${OFFER_SUBJECT_PREFIX} offer ${offer.transfer_id} :: ${offer.filename}`;
  const text = [
    `AgentCroc file transfer offer`,
    ``,
    `From: ${offer.from}`,
    `To: ${offer.to}`,
    `File: ${offer.filename}`,
    `Mode: ${offer.mode}`,
    `Transfer ID: ${offer.transfer_id}`,
    `Expires: ${offer.expires_at}`,
    ``,
    `This message is a pickup slip only — the file bytes are NOT attached.`,
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
