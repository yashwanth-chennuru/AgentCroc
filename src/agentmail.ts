import { AgentMailClient } from "agentmail";
import type { Config } from "./config.js";
import {
  FileOffer,
  OFFER_SUBJECT_PREFIX,
  RECEIVED_LABEL,
  offerIsExpired,
  parseOfferFromText,
  serializeOffer,
} from "./offer.js";

export interface ListedOffer {
  offer: FileOffer;
  messageId: string;
  receivedAt?: string;
  labels: string[];
  alreadyReceived: boolean;
}

export function createMailClient(config: Config): AgentMailClient {
  return new AgentMailClient({ apiKey: config.agentmailApiKey });
}

/**
 * AgentMail's HttpResponsePromise normally unwraps `{ data }` on await.
 * Be defensive in case a caller/runtime surfaces the wrapper instead.
 */
export function unwrapSdkData<T extends object>(value: T | { data: T }): T {
  if (
    value &&
    typeof value === "object" &&
    "data" in value &&
    (value as { data: unknown }).data &&
    typeof (value as { data: unknown }).data === "object" &&
    !("messageId" in value) &&
    !("messages" in value)
  ) {
    return (value as { data: T }).data;
  }
  return value as T;
}

export async function sendOfferEmail(
  config: Config,
  client: AgentMailClient,
  offer: FileOffer,
): Promise<{ messageId: string; threadId?: string }> {
  const { subject, text } = serializeOffer(offer);
  const result = unwrapSdkData(
    await client.inboxes.messages.send(config.inboxId, {
      to: offer.to,
      subject,
      text,
      labels: ["agentcroc-offer"],
    }),
  );
  return {
    messageId: result.messageId,
    threadId: result.threadId,
  };
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function senderMatches(fromField: string | undefined, expected: string): boolean {
  if (!fromField) return false;
  const expectedNorm = normalizeAddress(expected);
  const actual = normalizeAddress(fromField);
  return (
    actual === expectedNorm ||
    actual.includes(`<${expectedNorm}>`) ||
    actual.includes(expectedNorm)
  );
}

function subjectLooksLikeOffer(subject: string | undefined): boolean {
  return typeof subject === "string" && subject.includes(OFFER_SUBJECT_PREFIX);
}

/**
 * Prefer the full AgentMail `text` body. `extractedText` is often just a short
 * preview (e.g. "AgentCroc file transfer offer") and does not contain the
 * AGENTCROC_OFFER_BEGIN/END block.
 */
export function offerBodyFromMessage(msg: {
  text?: string | null;
  extractedText?: string | null;
}): string {
  const full = typeof msg.text === "string" ? msg.text.trim() : "";
  if (full) return full;
  const extracted = typeof msg.extractedText === "string" ? msg.extractedText.trim() : "";
  return extracted;
}

export interface ListOffersResult {
  offers: ListedOffer[];
  skipped: Array<{ messageId: string; subject?: string; reason: string }>;
}

export async function listOffers(
  config: Config,
  client: AgentMailClient,
  options: {
    from?: string;
    includeReceived?: boolean;
    includeExpired?: boolean;
    limit?: number;
  } = {},
): Promise<ListedOffer[]> {
  const { offers } = await listOffersDetailed(config, client, options);
  return offers;
}

export async function listOffersDetailed(
  config: Config,
  client: AgentMailClient,
  options: {
    from?: string;
    includeReceived?: boolean;
    includeExpired?: boolean;
    limit?: number;
  } = {},
): Promise<ListOffersResult> {
  const limit = options.limit ?? 50;

  // Important: AgentMail serves from/to/subject filters via a search path that
  // can hide `unauthenticated` mail. Agent-to-agent offers often land with that
  // label, so we list with include flags and filter client-side instead.
  const list = unwrapSdkData(
    await client.inboxes.messages.list(config.inboxId, {
      limit: Math.max(limit, 50),
      includeUnauthenticated: true,
      includeSpam: true,
      ...(options.from ? { from: [options.from] } : {}),
    }),
  );

  const results: ListedOffer[] = [];
  const skipped: ListOffersResult["skipped"] = [];

  for (const item of list.messages ?? []) {
    if (!subjectLooksLikeOffer(item.subject) && !(item.labels ?? []).includes("agentcroc-offer")) {
      // Still fetch a few recent messages without our subject mark in case labels
      // were stripped, but skip obvious non-offers when subject is present.
      if (item.subject && !subjectLooksLikeOffer(item.subject)) continue;
    }

    const msg = unwrapSdkData(
      await client.inboxes.messages.get(config.inboxId, item.messageId),
    );
    const body = offerBodyFromMessage(msg);
    const offer = parseOfferFromText(body);
    if (!offer) {
      if (subjectLooksLikeOffer(msg.subject ?? item.subject)) {
        skipped.push({
          messageId: msg.messageId,
          subject: msg.subject ?? item.subject,
          reason:
            "Subject looks like an AgentCroc offer but body has no parseable AGENTCROC_OFFER block (check text vs extractedText).",
        });
      }
      continue;
    }
    if (
      options.from &&
      !senderMatches(offer.from, options.from) &&
      !senderMatches(msg.from, options.from)
    ) {
      continue;
    }
    const labels = msg.labels ?? [];
    const alreadyReceived = labels.includes(RECEIVED_LABEL);
    if (alreadyReceived && !options.includeReceived) {
      skipped.push({
        messageId: msg.messageId,
        subject: msg.subject,
        reason: "already marked agentcroc-received",
      });
      continue;
    }
    if (offerIsExpired(offer) && !options.includeExpired) {
      skipped.push({
        messageId: msg.messageId,
        subject: msg.subject,
        reason: `expired at ${offer.expires_at}`,
      });
      continue;
    }

    results.push({
      offer,
      messageId: msg.messageId,
      receivedAt: msg.timestamp ? String(msg.timestamp) : undefined,
      labels,
      alreadyReceived,
    });

    if (results.length >= limit) break;
  }
  return { offers: results, skipped };
}

export async function markOfferReceived(
  config: Config,
  client: AgentMailClient,
  messageId: string,
): Promise<void> {
  await client.inboxes.messages.update(config.inboxId, messageId, {
    addLabels: [RECEIVED_LABEL],
  });
}
