import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertPathExists, loadConfig, type Config } from "./config.js";
import {
  createMailClient,
  listOffersDetailed,
  markOfferReceived,
  sendOfferEmail,
} from "./agentmail.js";
import {
  crocLiveSend,
  crocReceiveLive,
  crocReceiveStore,
  crocStoreSend,
  fileSizeBytes,
  generateLiveCode,
  generateTransferId,
  waitForLiveSenderReady,
} from "./croc.js";
import type { FileOffer } from "./offer.js";
import { OFFER_PROTOCOL, openOfferSecrets, sealOfferForMailbox } from "./offer.js";
import {
  generatePairSecret,
  getPairSecret,
  listPairs,
  removePair,
  upsertPair,
} from "./pairs.js";

function textResult(data: unknown, isError = false) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
    isError,
  };
}

function defaultExpiry(mode: "store" | "live", storeExpiresAt?: string): string {
  if (storeExpiresAt) return storeExpiresAt;
  const hours = mode === "store" ? 24 : 1;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function prepareOfferForMail(
  config: Config,
  offer: FileOffer,
  peerEmail: string,
): { mailboxOffer: FileOffer; sealed: boolean } {
  const secret = getPairSecret(config.pairsFile, peerEmail);
  if (!secret) {
    if (config.requirePair) {
      throw new Error(
        `No pair with ${peerEmail}. Run pair_create on one agent and pair_accept on the other first.`,
      );
    }
    return { mailboxOffer: offer, sealed: false };
  }
  return { mailboxOffer: sealOfferForMailbox(offer, secret), sealed: true };
}

export function registerTools(server: McpServer, config: Config = loadConfig()): void {
  const mail = createMailClient(config);

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Show this AgentCroc agent's configured AgentMail identity and transfer defaults.",
    },
    async () =>
      textResult({
        inbox_id: config.inboxId,
        default_mode: config.defaultMode,
        download_dir: config.downloadDir,
        store_url: config.crocStoreUrl,
        relay: config.crocRelay ?? "(croc public default)",
        pairs_file: config.pairsFile,
        require_pair: config.requirePair,
        paired_peers: listPairs(config.pairsFile).map((p) => p.peer),
      }),
  );

  server.registerTool(
    "pair_create",
    {
      title: "Create pair with peer agent",
      description:
        "One-time pairing: generate a shared secret for a peer agent email, store it locally, and return the secret once so the peer can run pair_accept. After both sides store it, send_file seals redeem tokens so AgentMail cannot read them.",
      inputSchema: {
        peer_email: z
          .string()
          .email()
          .describe("Peer agent email, e.g. yashjee22@agentmail.to"),
      },
    },
    async ({ peer_email }) => {
      try {
        const secret = generatePairSecret();
        upsertPair(config.pairsFile, peer_email, secret);
        return textResult({
          status: "pair_created",
          peer_email,
          shared_secret: secret,
          pairs_file: config.pairsFile,
          next_step: `On the peer agent, run pair_accept with peer_email=${config.inboxId} and this shared_secret. Share the secret out-of-band (chat), not via AgentMail if you can avoid it.`,
        });
      } catch (err) {
        return textResult(
          { error: err instanceof Error ? err.message : String(err) },
          true,
        );
      }
    },
  );

  server.registerTool(
    "pair_accept",
    {
      title: "Accept pair shared secret",
      description:
        "Store a shared secret created by the peer agent's pair_create. Do this once per relationship.",
      inputSchema: {
        peer_email: z
          .string()
          .email()
          .describe("The other agent's email (who ran pair_create)"),
        shared_secret: z
          .string()
          .min(16)
          .describe("Shared secret returned by peer's pair_create"),
      },
    },
    async ({ peer_email, shared_secret }) => {
      try {
        upsertPair(config.pairsFile, peer_email, shared_secret);
        return textResult({
          status: "pair_accepted",
          peer_email,
          pairs_file: config.pairsFile,
          note: "Pairing complete. Future send_file offers to/from this peer will seal redeem tokens.",
        });
      } catch (err) {
        return textResult(
          { error: err instanceof Error ? err.message : String(err) },
          true,
        );
      }
    },
  );

  server.registerTool(
    "pair_list",
    {
      title: "List paired agents",
      description: "List peer agent emails this runtime has a shared pairing secret for.",
    },
    async () =>
      textResult({
        pairs_file: config.pairsFile,
        pairs: listPairs(config.pairsFile),
      }),
  );

  server.registerTool(
    "pair_remove",
    {
      title: "Remove pair",
      description: "Delete the local shared secret for a peer agent.",
      inputSchema: {
        peer_email: z.string().email().describe("Peer agent email to unpair"),
      },
    },
    async ({ peer_email }) => {
      try {
        const removed = removePair(config.pairsFile, peer_email);
        return textResult({
          status: removed ? "removed" : "not_found",
          peer_email,
        });
      } catch (err) {
        return textResult(
          { error: err instanceof Error ? err.message : String(err) },
          true,
        );
      }
    },
  );

  server.registerTool(
    "send_file",
    {
      title: "Send file to agent",
      description:
        "Send a file to another agent identified by AgentMail address. Uploads ciphertext via croc (default: async store on getcroc.com), then emails a tiny AgentCroc offer (pickup slip) to the recipient. If a pair exists, redeem tokens are sealed so AgentMail cannot read them. The file itself is NOT sent over email.",
      inputSchema: {
        to: z
          .string()
          .email()
          .describe("Recipient agent email, e.g. agentB@agentmail.to"),
        path: z.string().describe("Absolute or relative path to the local file to send"),
        mode: z
          .enum(["store", "live"])
          .optional()
          .describe(
            'Transfer mode. "store" (default) is async via getcroc.com encrypted storage. "live" starts waiting on the public croc relay and returns immediately; the recipient must call receive_file while the sender is still waiting.',
          ),
      },
    },
    async ({ to, path: filePath, mode }) => {
      try {
        const resolved = assertPathExists(filePath);
        const transferMode = mode ?? config.defaultMode;
        const filename = path.basename(resolved);
        const size = fileSizeBytes(resolved);
        const transferId = generateTransferId();
        const from = config.inboxId;

        if (transferMode === "store") {
          const stored = await crocStoreSend(config, resolved);
          const offer: FileOffer = {
            protocol: OFFER_PROTOCOL,
            transfer_id: transferId,
            from,
            to,
            filename,
            size_bytes: size,
            mode: "store",
            store_token: stored.storeToken,
            browser_link: stored.browserLink,
            revoke_id: stored.revokeId,
            store_url: config.crocStoreUrl,
            created_at: new Date().toISOString(),
            expires_at: defaultExpiry("store", stored.expiresAt),
          };
          const { mailboxOffer, sealed } = prepareOfferForMail(config, offer, to);
          const mailResult = await sendOfferEmail(config, mail, mailboxOffer);
          return textResult({
            status: "offer_sent",
            mode: "store",
            transfer_id: transferId,
            to,
            filename,
            size_bytes: size,
            expires_at: offer.expires_at,
            offer_message_id: mailResult.messageId,
            sealed,
            note: sealed
              ? "Offer sealed with pair secret. Recipient must be paired to receive."
              : "No pair with recipient — redeem token sent in plaintext offer. Run pair_create/pair_accept to seal future offers.",
          });
        }

        const code = generateLiveCode();
        const offer: FileOffer = {
          protocol: OFFER_PROTOCOL,
          transfer_id: transferId,
          from,
          to,
          filename,
          size_bytes: size,
          mode: "live",
          code,
          relay: config.crocRelay,
          created_at: new Date().toISOString(),
          expires_at: defaultExpiry("live"),
        };
        const live = crocLiveSend(config, resolved, code);
        await waitForLiveSenderReady();
        const { mailboxOffer, sealed } = prepareOfferForMail(config, offer, to);
        const mailResult = await sendOfferEmail(config, mail, mailboxOffer);
        void live;
        return textResult({
          status: "waiting_for_receiver",
          mode: "live",
          transfer_id: transferId,
          to,
          filename,
          size_bytes: size,
          expires_at: offer.expires_at,
          offer_message_id: mailResult.messageId,
          sealed,
          note: sealed
            ? "Sealed live offer sent. Recipient must be paired and call receive_file soon."
            : "Sender is waiting on the croc relay. Recipient should call receive_file soon. Tip: pair agents to seal live codes.",
        });
      } catch (err) {
        return textResult(
          { error: err instanceof Error ? err.message : String(err) },
          true,
        );
      }
    },
  );

  server.registerTool(
    "list_offers",
    {
      title: "List pending file offers",
      description:
        "List AgentCroc file-transfer offers in this agent's AgentMail inbox (tiny pickup slips, not file attachments).",
      inputSchema: {
        from: z
          .string()
          .email()
          .optional()
          .describe("Only show offers from this sender agent email"),
        include_received: z
          .boolean()
          .optional()
          .describe("Include offers already marked received (default false)"),
        include_expired: z
          .boolean()
          .optional()
          .describe("Include expired offers (default false)"),
      },
    },
    async ({ from, include_received, include_expired }) => {
      try {
        const { offers, skipped } = await listOffersDetailed(config, mail, {
          from,
          includeReceived: include_received,
          includeExpired: include_expired,
        });
        return textResult({
          count: offers.length,
          offers: offers.map((o) => ({
            transfer_id: o.offer.transfer_id,
            from: o.offer.from,
            filename: o.offer.filename,
            size_bytes: o.offer.size_bytes,
            mode: o.offer.mode,
            sealed: Boolean(o.offer.sealed),
            expires_at: o.offer.expires_at,
            message_id: o.messageId,
            already_received: o.alreadyReceived,
          })),
          skipped: skipped.slice(0, 20),
        });
      } catch (err) {
        return textResult(
          { error: err instanceof Error ? err.message : String(err) },
          true,
        );
      }
    },
  );

  server.registerTool(
    "receive_file",
    {
      title: "Receive file from agent",
      description:
        "Receive a file offered by another agent. Looks up the AgentCroc offer in AgentMail, unseals redeem secrets if paired, then fetches & decrypts bytes via croc. Does not download email attachments.",
      inputSchema: {
        from: z
          .string()
          .email()
          .optional()
          .describe("Sender agent email, e.g. agentA@agentmail.to"),
        transfer_id: z
          .string()
          .optional()
          .describe("Specific transfer id from list_offers"),
        out_dir: z
          .string()
          .optional()
          .describe("Directory to write the received file (default AGENTCROC_DOWNLOAD_DIR)"),
      },
    },
    async ({ from, transfer_id, out_dir }) => {
      try {
        const { offers, skipped } = await listOffersDetailed(config, mail, {
          from,
          includeReceived: false,
          includeExpired: false,
          limit: 50,
        });

        let selected = offers;
        if (transfer_id) {
          selected = offers.filter((o) => o.offer.transfer_id === transfer_id);
        }
        if (selected.length === 0) {
          return textResult(
            {
              error: "No matching pending AgentCroc offers found.",
              hint: "Ask the sender to send_file, or call list_offers. For live mode, sender must still be waiting.",
              from,
              transfer_id,
              skipped: skipped.slice(0, 20),
            },
            true,
          );
        }
        if (!transfer_id && selected.length > 1) {
          return textResult(
            {
              error: "Multiple pending offers found; pass transfer_id to choose one.",
              offers: selected.map((o) => ({
                transfer_id: o.offer.transfer_id,
                from: o.offer.from,
                filename: o.offer.filename,
                mode: o.offer.mode,
                sealed: Boolean(o.offer.sealed),
                expires_at: o.offer.expires_at,
              })),
            },
            true,
          );
        }

        const chosen = selected[0]!;
        const dest = path.resolve(out_dir || config.downloadDir);
        const pairSecret = getPairSecret(config.pairsFile, chosen.offer.from);
        const offer = openOfferSecrets(chosen.offer, pairSecret);

        if (offer.mode === "store") {
          if (!offer.store_token) {
            throw new Error("Offer is missing store_token (unseal may have failed)");
          }
          await crocReceiveStore(config, offer.store_token, dest);
        } else {
          if (!offer.code) {
            throw new Error("Offer is missing live code (unseal may have failed)");
          }
          await crocReceiveLive(config, offer.code, dest);
        }

        await markOfferReceived(config, mail, chosen.messageId);

        return textResult({
          status: "received",
          transfer_id: offer.transfer_id,
          from: offer.from,
          filename: offer.filename,
          mode: offer.mode,
          sealed: Boolean(chosen.offer.sealed),
          out_dir: dest,
          saved_as: path.join(dest, offer.filename),
        });
      } catch (err) {
        return textResult(
          { error: err instanceof Error ? err.message : String(err) },
          true,
        );
      }
    },
  );
}
