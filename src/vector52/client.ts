/**
 * Plain (non-x402) HTTP client for the free Vector52 backend endpoints that
 * the MCP contract documents as FREE tools: case_status, evidence_get,
 * package_verify and anchor_lookup (docs/CONTRATO-INTEGRACION.md "MCP
 * mapping"). These never sign or spend anything — no wallet, no payment
 * policy — they just proxy a GET/POST to the same fixed Vector52 backend
 * (see getVector52BackendUrl in ./backend.ts) that the paid wallet-flow
 * tool also targets.
 *
 * case_anchor (POST /v1/cases/{case_id}/anchor) is the on-chain write
 * counterpart of anchor_lookup: this MCP never touches HSK, signs a
 * transaction or holds a private key for it — it only forwards the
 * case_id (and an optional supersedes root) that the case's own audit
 * already produced. The backend looks up its internal record for that
 * case_id, computes manifest_root = sha256(manifest.json) from the
 * already-built .v52.zip, and does the actual anchorCase() call against
 * V52EvidenceRegistry (app/onchain/hsk_registry.py). All this tool returns
 * is what the backend hands back: tx_hash, block_number, explorer URLs.
 *
 * edge_explain and claim_audit are intentionally NOT implemented here: the
 * backend has no `GET /v1/cases/{id}/graph` and `POST /v1/paid/claim-audit`
 * is documented as pending in v52-backend/docs/X402_MCP.md §1 ("Nivel 3 …
 * todavía no implementado en código"). Adding tools for endpoints that do
 * not exist would fabricate a READY state the backend itself refuses to
 * fake (see v52-backend/app/api/integrations.py).
 */
import { getVector52BackendUrl } from "./backend.js";
import { X402Error } from "../x402/errors.js";

const MAX_PACKAGE_BYTES = 100 * 1024 * 1024; // matches the backend's own limit in app/api/verify.py

const safeFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    redirect: "error",
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });

async function readJsonOrText(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

function errorDetailToMessage(payload: unknown, status: number): string {
  if (payload !== null && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    return typeof detail === "string" ? detail : JSON.stringify(detail);
  }
  return `HTTP ${status}`;
}

async function backendRequest(path: string, init?: RequestInit): Promise<unknown> {
  const url = new URL(path, getVector52BackendUrl());

  let response: Response;
  try {
    response = await safeFetch(url, init);
  } catch {
    throw new X402Error(
      "VECTOR52_REQUEST_FAILED",
      "No se pudo contactar a v52-backend. Verifica que el servicio esté arriba.",
    );
  }

  const payload = await readJsonOrText(response);
  if (!response.ok) {
    const code = response.status === 404 ? "VECTOR52_NOT_FOUND" : "VECTOR52_REQUEST_FAILED";
    throw new X402Error(code, errorDetailToMessage(payload, response.status));
  }
  return payload;
}

function assertNonEmptyId(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new X402Error("VECTOR52_REQUEST_INVALID", `${name} no puede estar vacío.`);
  }
  return trimmed;
}

/** case_status — GET /v1/cases/{case_id} */
export async function getCaseStatus(caseId: string): Promise<unknown> {
  const id = assertNonEmptyId(caseId, "caseId");
  return backendRequest(`/v1/cases/${encodeURIComponent(id)}`);
}

/** evidence_get — GET /v1/cases/{case_id}/evidence */
export async function getCaseEvidence(caseId: string): Promise<unknown> {
  const id = assertNonEmptyId(caseId, "caseId");
  return backendRequest(`/v1/cases/${encodeURIComponent(id)}/evidence`);
}

const MANIFEST_ROOT_RE = /^0x[0-9a-fA-F]{64}$/;

/** anchor_lookup — GET /v1/anchors/{manifest_root} (public, no signer needed) */
export async function getAnchor(manifestRoot: string): Promise<unknown> {
  if (!MANIFEST_ROOT_RE.test(manifestRoot)) {
    throw new X402Error(
      "VECTOR52_REQUEST_INVALID",
      "manifestRoot debe ser un hash sha256 de 32 bytes con prefijo 0x (64 caracteres hex).",
    );
  }
  return backendRequest(`/v1/anchors/${manifestRoot.toLowerCase()}`);
}

/**
 * case_anchor — POST /v1/cases/{case_id}/anchor (write, on-chain on HSK)
 *
 * This never signs or broadcasts anything itself: it hands the case_id (and
 * an optional supersedes manifest_root) to v52-backend, which resolves its
 * own internal case record, computes the manifest_root and performs the
 * V52EvidenceRegistry.anchorCase() transaction with its own configured
 * signer. The response includes tx_hash and both explorer URLs so the
 * anchor can be verified independently of this MCP.
 */
export async function anchorCase(input: {
  caseId: string;
  supersedes?: string;
}): Promise<unknown> {
  const id = assertNonEmptyId(input.caseId, "caseId");
  if (input.supersedes !== undefined && !MANIFEST_ROOT_RE.test(input.supersedes)) {
    throw new X402Error(
      "VECTOR52_REQUEST_INVALID",
      "supersedes debe ser un hash sha256 de 32 bytes con prefijo 0x (64 caracteres hex).",
    );
  }

  return backendRequest(`/v1/cases/${encodeURIComponent(id)}/anchor`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      input.supersedes ? { supersedes: input.supersedes.toLowerCase() } : {},
    ),
  });
}

/** package_verify — POST /v1/verify (multipart upload of a .v52.zip package) */
export async function verifyPackage(input: { fileBase64: string; fileName?: string }): Promise<unknown> {
  const base64 = input.fileBase64.trim();
  if (!base64) {
    throw new X402Error("VECTOR52_REQUEST_INVALID", "fileBase64 no puede estar vacío.");
  }

  // Buffer.from(..., "base64") never throws on malformed input — it silently
  // drops invalid characters — so garbage input surfaces as a non-empty but
  // corrupt payload, which the backend already rejects with "not a valid ZIP
  // archive" (see app/api/verify.py). Only the empty-content case is worth
  // catching client-side.
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) {
    throw new X402Error("VECTOR52_REQUEST_INVALID", "fileBase64 no decodifica a contenido no vacío.");
  }
  if (bytes.length > MAX_PACKAGE_BYTES) {
    throw new X402Error(
      "VECTOR52_REQUEST_INVALID",
      `El paquete supera el límite de ${MAX_PACKAGE_BYTES / 1024 / 1024} MB aceptado por v52-backend.`,
    );
  }

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/zip" }), input.fileName?.trim() || "package.v52.zip");

  return backendRequest("/v1/verify", { method: "POST", body: form });
}
