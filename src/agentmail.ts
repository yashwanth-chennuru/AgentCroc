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

export async function sendOfferEmail(
  config: Config,
  client: AgentMailClient,
  offer: FileOffer,
): Promise<{ messageId: string; threadId?: string }> {
  const { subject, text } = serializeOffer(offer);
  const result = await client.inboxes.messages.send(config.inboxId, {
    to: offer.to,
    subject,
    text,
    labels: ["agentcroc-offer"],
  });
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
  return actual === expectedNorm || actual.includes(`<${expectedNorm}>`) || actual.includes(expectedNorm);
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
  const limit = options.limit ?? 50;
  const list = await client.inboxes.messages.list(config.inboxId, {
    limit,
    subject: [OFFER_SUBJECT_PREFIX],
    ...(options.from ? { from: [options.from] } : {}),
  });

  const results: ListedOffer[] = [];
  for (const item of list.messages ?? []) {
    // List returns metadata only; fetch full message for the offer JSON body.
    const msg = await client.inboxes.messages.get(config.inboxId, item.messageId);
    const body = msg.extractedText ?? msg.text ?? "";
    const offer = parseOfferFromText(body);
    if (!offer) continue;
    if (
      options.from &&
      !senderMatches(offer.from, options.from) &&
      !senderMatches(msg.from, options.from)
    ) {
      continue;
    }
    const labels = msg.labels ?? [];
    const alreadyReceived = labels.includes(RECEIVED_LABEL);
    if (alreadyReceived && !options.includeReceived) continue;
    if (offerIsExpired(offer) && !options.includeExpired) continue;

    results.push({
      offer,
      messageId: msg.messageId,
      receivedAt: msg.timestamp ? String(msg.timestamp) : undefined,
      labels,
      alreadyReceived,
    });
  }
  return results;
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
