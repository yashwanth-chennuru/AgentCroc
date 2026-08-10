import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertPathExists, loadConfig, type Config } from "./config.js";
import {
  createMailClient,
  listOffers,
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
import { OFFER_PROTOCOL } from "./offer.js";

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
      }),
  );

  server.registerTool(
    "send_file",
    {
      title: "Send file to agent",
      description:
        "Send a file to another agent identified by AgentMail address. Uploads ciphertext via croc (default: async store on getcroc.com), then emails a tiny AgentCroc offer (pickup slip) to the recipient. The file itself is NOT sent over email.",
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
          const mailResult = await sendOfferEmail(config, mail, offer);
          return textResult({
            status: "offer_sent",
            mode: "store",
            transfer_id: transferId,
            to,
            filename,
            size_bytes: size,
            expires_at: offer.expires_at,
            offer_message_id: mailResult.messageId,
            note: "Recipient can call receive_file / list_offers. File bytes stay off AgentMail.",
          });
        }

        // live mode: start waiting on the relay, email the offer, return immediately.
        // (Awaiting completion here makes Cursor/opencode MCP calls time out.)
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
        const mailResult = await sendOfferEmail(config, mail, offer);
        // Intentionally do not await live.done — receiver should call receive_file next.
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
          note: "Sender is waiting on the croc relay. On the recipient agent, call receive_file soon (before live expiry).",
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
        const offers = await listOffers(config, mail, {
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
            expires_at: o.offer.expires_at,
            message_id: o.messageId,
            already_received: o.alreadyReceived,
          })),
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
        "Receive a file offered by another agent. Looks up the AgentCroc offer in AgentMail, then fetches & decrypts bytes via croc (store token or live code). Does not download email attachments.",
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
        const offers = await listOffers(config, mail, {
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
                expires_at: o.offer.expires_at,
              })),
            },
            true,
          );
        }

        const chosen = selected[0]!;
        const dest = path.resolve(out_dir || config.downloadDir);
        const offer = chosen.offer;

        if (offer.mode === "store") {
          if (!offer.store_token) {
            throw new Error("Offer is missing store_token");
          }
          await crocReceiveStore(config, offer.store_token, dest);
        } else {
          if (!offer.code) {
            throw new Error("Offer is missing live code");
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
