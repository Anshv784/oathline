// The Verdict contract's views, typed to match `contracts/verdict/src/views.rs`.

import fixture from "./fixtures/signed.json";
import { view } from "./near";
import { bytesToBase64 } from "./verify";

export const CONTRACT = import.meta.env.VITE_VERDICT_CONTRACT as string | undefined;

/** No contract configured: the app shows a labelled offline sample. */
export const PREVIEW = !CONTRACT;

export type Outcome =
  | { status: "pending" }
  | { status: "answered"; answer: string; reason: string }
  | { status: "failed"; reason: string };

export interface SignatureView {
  text: string;
  signature: string;
  signing_address: string;
  signing_algo: string;
  signature_kind: string | null;
}

export interface RequestView {
  id: string;
  requester: string;
  model: string;
  signer: string;
  instructions: string;
  submission: string;
  options: string[];
  tag: string;
  request_hash: string;
  created_at_ms: string;
  outcome: Outcome;
  completion_id: string | null;
  response_base64: string | null;
  signature: SignatureView | null;
  answered_at_ms: string | null;
}

export interface ImageView {
  mr_td: string;
  rt_mr0: string;
  rt_mr1: string;
  rt_mr2: string;
}

export interface ModelView {
  model: string;
  signing_address: string;
  compose_hash: string;
  image: ImageView;
  tcb_status: string;
  registered_by: string;
  registered_at_ms: string;
  expires_at_ms: string;
}

export interface PolicyView {
  deployments: { image: ImageView; compose_hash: string }[];
}

export interface ConfigView {
  owner_id: string;
  tee_verifier: string;
  outlayer: string;
  runner: { url: string; sha256: string };
  registration_ttl_ms: string;
  accepted_tcb_statuses: string[];
}

export interface CheckView {
  accepted: boolean;
  answer: string | null;
  reason: string | null;
  error: string | null;
}

// ---- offline sample -----------------------------------------------------------

const SAMPLE_TIME = "1793520000000";
const sampleImage: ImageView = { mr_td: "00".repeat(48), rt_mr0: "00".repeat(48), rt_mr1: "00".repeat(48), rt_mr2: "00".repeat(48) };

const sampleRequest: RequestView = {
  id: "0",
  requester: "charter-dao.testnet",
  model: fixture.model,
  signer: fixture.signer,
  instructions: fixture.instructions,
  submission: fixture.submission,
  options: fixture.options,
  tag: fixture.tag,
  request_hash: fixture.request_hash,
  created_at_ms: SAMPLE_TIME,
  outcome: {
    status: "answered",
    answer: "APPROVE",
    reason: "An open-source developer tool for NEAR contracts, within the charter.",
  },
  completion_id: "chatcmpl-fixture",
  response_base64: bytesToBase64(new TextEncoder().encode(fixture.response)),
  signature: fixture.signature,
  answered_at_ms: SAMPLE_TIME,
};

const sampleModel: ModelView = {
  model: fixture.model,
  signing_address: fixture.signer,
  compose_hash: "00".repeat(32),
  image: sampleImage,
  tcb_status: "UpToDate",
  registered_by: "sample.testnet",
  registered_at_ms: SAMPLE_TIME,
  expires_at_ms: String(Number(SAMPLE_TIME) + 7 * 86_400_000),
};

// ---- reads ---------------------------------------------------------------------

export async function listRequests(signal?: AbortSignal): Promise<RequestView[]> {
  if (PREVIEW) return [sampleRequest];
  return view<RequestView[]>(CONTRACT!, "list_requests", { limit: 30 }, signal);
}

export async function getRequest(id: string, signal?: AbortSignal): Promise<RequestView | null> {
  if (PREVIEW) return id === "0" ? sampleRequest : null;
  return view<RequestView | null>(CONTRACT!, "get_request", { request_id: id }, signal);
}

export async function listModels(signal?: AbortSignal): Promise<[string, ModelView | null][]> {
  if (PREVIEW) return [[fixture.model, sampleModel]];
  return view<[string, ModelView | null][]>(CONTRACT!, "list_models", {}, signal);
}

export async function getPolicy(model: string, signal?: AbortSignal): Promise<PolicyView | null> {
  if (PREVIEW) return { deployments: [{ image: sampleImage, compose_hash: "00".repeat(32) }] };
  return view<PolicyView | null>(CONTRACT!, "get_policy", { model }, signal);
}

export async function getConfig(signal?: AbortSignal): Promise<ConfigView | null> {
  if (PREVIEW) return null;
  return view<ConfigView>(CONTRACT!, "config", {}, signal);
}

/** Asks the contract itself to judge an arbitrary response. */
export async function checkResponse(id: string, responseBase64: string, signature: SignatureView): Promise<CheckView | null> {
  if (PREVIEW) return null;
  return view<CheckView>(CONTRACT!, "check_response", {
    request_id: id,
    response_base64: responseBase64,
    signature,
  });
}
