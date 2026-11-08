// The oathline-market example's views, typed to match examples/oathline-market.

import { view } from "./near";

export const MARKET = (import.meta.env.VITE_MARKET_CONTRACT as string | undefined) ?? undefined;

export type MarketStatus =
  | { status: "open" }
  | { status: "resolving" }
  | { status: "resolved"; outcome: string; reason: string; verdict_request: string };

export interface Market {
  id: string;
  creator: string;
  question: string;
  rules: string;
  closes_at_ms: string;
  yes_pool: string;
  no_pool: string;
  status: MarketStatus;
  evidence: string | null;
  resolver: string | null;
  last_error: string | null;
}

export async function listMarkets(signal?: AbortSignal): Promise<Market[]> {
  if (!MARKET) return [];
  return view<Market[]>(MARKET, "list_markets", { limit: 30 }, signal);
}

/** yoctoNEAR string to a short NEAR amount. */
export function near(yocto: string): string {
  const value = Number(BigInt(yocto) / 10n ** 18n) / 1e6;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })} NEAR`;
}

export interface Source {
  url: string;
  anchor: string;
}

export interface Fetched {
  sha256: string;
  bytes: number;
  fetched_at_ms: string;
}

/** A market's fixed source, and what the TDX fetcher last saw there. */
export async function getSource(id: string, signal?: AbortSignal): Promise<[Source, Fetched | null] | null> {
  if (!MARKET) return null;
  return view<[Source, Fetched | null] | null>(MARKET, "get_source", { market_id: id }, signal);
}
