import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { unwrapSdkData } from "../src/agentmail.js";
import { parseCrocExpiry } from "../src/croc.js";
import {
  OFFER_PROTOCOL,
  openOfferSecrets,
  parseOfferFromText,
  sealOfferForMailbox,
  serializeOffer,
  type FileOffer,
} from "../src/offer.js";
import { generatePairSecret, getPairSecret, upsertPair } from "../src/pairs.js";
import { sealSecrets, unsealSecrets } from "../src/seal.js";

assert.deepEqual(unwrapSdkData({ messages: [1] }), { messages: [1] });
assert.deepEqual(unwrapSdkData({ data: { messages: [1] } }), { messages: [1] });
assert.deepEqual(
  unwrapSdkData({ messageId: "m1", data: "noise" } as { messageId: string; data: string }),
  { messageId: "m1", data: "noise" },
);

const offer: FileOffer = {
  protocol: OFFER_PROTOCOL,
  transfer_id: "tr_test",
  from: "a@agentmail.to",
  to: "b@agentmail.to",
  filename: "hiringdata.pdf",
  size_bytes: 123,
  mode: "store",
  store_token: "croc-store-v1.example.token",
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
};

const { subject, text } = serializeOffer(offer);
assert.ok(subject.includes("[AgentCroc]"));
const parsed = parseOfferFromText(text);
assert.ok(parsed);
assert.equal(parsed!.transfer_id, "tr_test");
assert.equal(parsed!.store_token, offer.store_token);
assert.equal(parseOfferFromText("no offer here"), null);

assert.equal(parseCrocExpiry(undefined), undefined);
assert.equal(parseCrocExpiry("not a date"), undefined);
const parsedExpiry = parseCrocExpiry("Tue, 11 Aug 2026 17:50:45 UTC");
assert.ok(parsedExpiry);
assert.equal(parsedExpiry, new Date("Tue, 11 Aug 2026 17:50:45 UTC").toISOString());

const secret = generatePairSecret();
const sealedBlob = sealSecrets(secret, "tr_test", { store_token: "tok", code: "c" });
const opened = unsealSecrets(secret, "tr_test", sealedBlob);
assert.equal(opened.store_token, "tok");
assert.equal(opened.code, "c");

const mailbox = sealOfferForMailbox(offer, secret);
assert.equal(mailbox.sealed, true);
assert.equal(mailbox.store_token, undefined);
assert.ok(mailbox.encrypted_payload);
const { text: sealedText } = serializeOffer(mailbox);
assert.ok(!sealedText.includes("croc-store-v1.example.token"));
const parsedSealed = parseOfferFromText(sealedText);
assert.ok(parsedSealed?.sealed);
const restored = openOfferSecrets(parsedSealed!, secret);
assert.equal(restored.store_token, "croc-store-v1.example.token");

const dir = mkdtempSync(path.join(tmpdir(), "agentcroc-pairs-"));
const pairsFile = path.join(dir, "pairs.json");
upsertPair(pairsFile, "B@AgentMail.to", secret);
assert.equal(getPairSecret(pairsFile, "b@agentmail.to"), secret);
rmSync(dir, { recursive: true, force: true });

console.log("offer round-trip ok");
console.log("croc expiry parse ok");
console.log("sdk unwrap ok");
console.log("seal/pair ok");
