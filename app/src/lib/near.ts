// Read-only calls to a NEAR contract over JSON-RPC.

export const NETWORK = (import.meta.env.VITE_NEAR_NETWORK as string | undefined) ?? "testnet";

const RPC: Record<string, string> = {
  testnet: "https://rpc.testnet.near.org",
  mainnet: "https://rpc.mainnet.near.org",
};

export const EXPLORER: Record<string, string> = {
  testnet: "https://testnet.nearblocks.io",
  mainnet: "https://nearblocks.io",
};

export class RpcError extends Error {}

export async function view<T>(contract: string, method: string, args: object = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(RPC[NETWORK] ?? RPC.testnet, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "verdict-app",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contract,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  if (!response.ok) throw new RpcError(`NEAR RPC answered ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new RpcError(payload.error?.cause?.name ?? payload.error.message ?? "RPC error");
  if (payload.result?.error) throw new RpcError(String(payload.result.error));
  const bytes = Uint8Array.from(payload.result.result as number[]);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
