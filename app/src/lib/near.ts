// Read-only calls to a NEAR contract over JSON-RPC.

export const NETWORK = (import.meta.env.VITE_NEAR_NETWORK as string | undefined) ?? "testnet";

// FastNEAR answers views several times faster than the public endpoint,
// which is kept as a fallback.
const RPC: Record<string, string[]> = {
  testnet: ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"],
  mainnet: ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"],
};

export const EXPLORER: Record<string, string> = {
  testnet: "https://testnet.nearblocks.io",
  mainnet: "https://nearblocks.io",
};

export class RpcError extends Error {}

export async function view<T>(contract: string, method: string, args: object = {}, signal?: AbortSignal): Promise<T> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: "oathline-app",
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: contract,
      method_name: method,
      args_base64: btoa(JSON.stringify(args)),
    },
  });
  let lastError: unknown;
  for (const url of RPC[NETWORK] ?? RPC.testnet) {
    try {
      return await call<T>(url, body, signal);
    } catch (error) {
      // A contract error is the answer; only transport failures move on.
      if (error instanceof RpcError || signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

async function call<T>(url: string, body: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal });
  if (!response.ok) throw new Error(`NEAR RPC answered ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new RpcError(payload.error?.cause?.name ?? payload.error.message ?? "RPC error");
  if (payload.result?.error) throw new RpcError(String(payload.result.error));
  const bytes = Uint8Array.from(payload.result.result as number[]);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
