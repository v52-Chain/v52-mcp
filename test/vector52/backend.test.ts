import assert from "node:assert/strict";
import test from "node:test";

import { getVector52BackendUrl } from "../../src/vector52/backend.js";
import { X402Error } from "../../src/x402/errors.js";

test("Vector52 backend defaults to the deployed Render service", () => {
  assert.equal(
    getVector52BackendUrl({}).toString(),
    "https://v52-backend.onrender.com/",
  );
});

test("Vector52 backend rejects non-HTTPS external targets", () => {
  assert.throws(
    () => getVector52BackendUrl({ V52_BACKEND_URL: "http://example.com" }),
    (error: unknown) =>
      error instanceof X402Error && error.code === "V52_BACKEND_CONFIGURATION_INVALID",
  );
});

test("Vector52 backend strips query and fragment from configured base", () => {
  assert.equal(
    getVector52BackendUrl({ V52_BACKEND_URL: "https://api.example/v1/?token=nope#fragment" }).toString(),
    "https://api.example/v1",
  );
});
