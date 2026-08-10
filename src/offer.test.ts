import { strict as assert } from "node:assert";
import {
  OFFER_PROTOCOL,
  parseOfferFromText,
  serializeOffer,
  type FileOffer,
} from "../src/offer.js";

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

console.log("offer round-trip ok");
