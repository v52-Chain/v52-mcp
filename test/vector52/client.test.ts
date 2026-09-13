import assert from "node:assert/strict";
import test from "node:test";

import { X402Error } from "../../src/x402/errors.js";

process.env.V52_BACKEND_URL = "http://127.0.0.1:8000";
process.env.NODE_ENV = "development";

const { getAnchor, getCaseStatus, getCaseEvidence, verifyPackage } = await import("../../src/vector52/client.js");

function expectCode(fn: () => Promise<unknown>, code: string) {
  return assert.rejects(fn, (error: unknown) => error instanceof X402Error && error.code === code);
}

test("case_status rejects an empty caseId before hitting the network", async () => {
  await expectCode(() => getCaseStatus("   "), "VECTOR52_REQUEST_INVALID");
});

test("evidence_get rejects an empty caseId before hitting the network", async () => {
  await expectCode(() => getCaseEvidence(""), "VECTOR52_REQUEST_INVALID");
});

test("anchor_lookup rejects a malformed manifestRoot before hitting the network", async () => {
  await expectCode(() => getAnchor("0xdeadbeef"), "VECTOR52_REQUEST_INVALID");
  await expectCode(() => getAnchor("not-a-hash"), "VECTOR52_REQUEST_INVALID");
});

test("anchor_lookup accepts a well-formed manifestRoot and reaches the network layer", async () => {
  // No local v52-backend is expected to be running in CI; VECTOR52_REQUEST_FAILED
  // (network error) proves validation passed and the request was actually attempted,
  // as opposed to VECTOR52_REQUEST_INVALID (rejected before ever calling fetch).
  const validRoot = "0x" + "ab".repeat(32);
  await expectCode(() => getAnchor(validRoot), "VECTOR52_REQUEST_FAILED");
});

test("package_verify rejects empty or invalid base64 before hitting the network", async () => {
  await expectCode(() => verifyPackage({ fileBase64: "" }), "VECTOR52_REQUEST_INVALID");
  await expectCode(() => verifyPackage({ fileBase64: "   " }), "VECTOR52_REQUEST_INVALID");
});
