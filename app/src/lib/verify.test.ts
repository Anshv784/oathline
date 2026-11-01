// The fixture is produced by verdict-core (`cargo run -p verdict-core
// --example export_fixture`), so these tests pin the browser verifier to
// the contract's own byte-level output.

import { describe, expect, it } from "vitest";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import fixture from "./fixtures/signed.json";
import { recoverAddress, requestBody, sha256Hex, verifyResponse, type Question } from "./verify";

const question: Question = {
  model: fixture.model,
  instructions: fixture.instructions,
  submission: fixture.submission,
  options: fixture.options,
  tag: fixture.tag,
};
const response = utf8ToBytes(fixture.response);

describe("browser verifier", () => {
  it("rebuilds the request body byte for byte", () => {
    expect(requestBody(question)).toBe(fixture.body);
    expect(sha256Hex(utf8ToBytes(requestBody(question)))).toBe(fixture.request_hash);
  });

  it("recovers the signer the way the contract does", () => {
    expect(recoverAddress(fixture.signature.text, fixture.signature.signature)).toBe(fixture.signer);
  });

  it("accepts the untouched response", () => {
    const report = verifyResponse(question, fixture.request_hash, response, fixture.signature, fixture.signer);
    expect(report.accepted).toBe(true);
    expect(report.answer?.answer).toBe("APPROVE");
  });

  it("rejects an edited response", () => {
    const edited = utf8ToBytes(fixture.response.replace("APPROVE", "REJECT"));
    const report = verifyResponse(question, fixture.request_hash, edited, fixture.signature, fixture.signer);
    expect(report.accepted).toBe(false);
    expect(report.checks.find((c) => c.id === "text")?.passed).toBe(false);
  });

  it("rejects a different registered key", () => {
    const report = verifyResponse(question, fixture.request_hash, response, fixture.signature, `0x${"11".repeat(20)}`);
    expect(report.checks.find((c) => c.id === "signer")?.passed).toBe(false);
  });

  it("rejects a question that was changed after signing", () => {
    const changed = { ...question, submission: `${question.submission} ` };
    const report = verifyResponse(changed, fixture.request_hash, response, fixture.signature, fixture.signer);
    expect(report.checks.find((c) => c.id === "request")?.passed).toBe(false);
  });
});
