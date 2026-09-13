import assert from "node:assert/strict";
import test from "node:test";

import { getVector52BackendUrl } from "../../src/vector52/backend.js";

test("Vector52 backend is fixed to the deployed Render service", () => {
  assert.equal(getVector52BackendUrl().toString(), "https://v52-backend.onrender.com/");
});
