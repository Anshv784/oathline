import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Label, Notice, Panel, Skeleton, Tag, formatTime } from "../components/ui";
import { MARKET, listMarkets, near, type Market } from "../lib/market";
import { useLoad } from "../lib/useLoad";

export function Markets() {
  const [markets, retry] = useLoad(listMarkets, "markets");

  return (
    <div className="space-y-10">
      <section className="max-w-3xl">
        <h1 className="text-[28px] font-semibold tracking-tight md:text-[34px]">Example: a prediction market</h1>
        <p className="mt-3 max-w-prose text-[16px] leading-relaxed text-ink-2">
          People bet NEAR on YES or NO. After the market closes, anyone posts evidence, and the market asks Verdict to decide
          YES, NO or INVALID under the market's written rules. No token vote, no whale, no relayer to trust. Winners split the
          pot; INVALID refunds everyone.
        </p>
        <p className="mt-3 max-w-prose text-[14px] leading-relaxed text-ink-2">
          Verdict proves the AI judged this evidence under these rules. It does not make the evidence true, so the evidence is
          stored with the market for anyone to read.
        </p>
      </section>

      {!MARKET && <Notice title="No market contract configured">Set VITE_MARKET_CONTRACT to read one.</Notice>}
      {markets.state === "loading" && MARKET && <Skeleton className="h-64" />}
      {markets.state === "error" && (
        <Notice tone="fail" title="Couldn't read the markets" action={<Button variant="outline" onClick={retry}>Try again</Button>}>
          {markets.message}
        </Notice>
      )}
      {markets.state === "ready" && markets.data.map((market) => <MarketCard key={market.id} market={market} />)}
    </div>
  );
}

function MarketCard({ market }: { market: Market }) {
  const resolved = market.status.status === "resolved" ? market.status : null;
  const tone = resolved ? (resolved.outcome === "INVALID" ? "wait" : "pass") : "plain";
  return (
    <Panel>
      <div className="flex flex-wrap items-start gap-3 border-b border-rule px-5 py-4">
        <h2 className="min-w-0 flex-1 text-[18px] font-semibold leading-snug">{market.question}</h2>
        <Tag tone={tone}>{resolved ? resolved.outcome : market.status.status.toUpperCase()}</Tag>
      </div>
      <div className="grid grid-cols-1 gap-6 px-5 py-5 lg:grid-cols-2">
        <div className="space-y-5">
          <div>
            <Label>Rules</Label>
            <p className="mt-2 text-[15px] leading-relaxed">{market.rules}</p>
          </div>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
            <div className="flex gap-2"><dt className="text-ink-2">YES pool</dt><dd className="font-mono">{near(market.yes_pool)}</dd></div>
            <div className="flex gap-2"><dt className="text-ink-2">NO pool</dt><dd className="font-mono">{near(market.no_pool)}</dd></div>
            <div className="flex gap-2"><dt className="text-ink-2">Closed</dt><dd className="font-mono">{formatTime(market.closes_at_ms)}</dd></div>
          </dl>
        </div>
        <div className="space-y-5">
          <div>
            <Label>Evidence posted{market.resolver ? ` by ${market.resolver}` : ""}</Label>
            <p className="mt-2 whitespace-pre-wrap rounded border border-rule bg-paper p-3 [overflow-wrap:anywhere] text-[14px] leading-relaxed">
              {market.evidence ?? "None yet."}
            </p>
          </div>
          {resolved && (
            <div>
              <Label>Verdict's answer</Label>
              <p className="mt-2 text-[15px] leading-relaxed">“{resolved.reason}”</p>
              <Link
                to={`/v/${resolved.verdict_request}`}
                className="mt-3 inline-flex items-center gap-1 text-[14px] font-medium underline underline-offset-4"
              >
                Check the proof for request #{resolved.verdict_request} <ArrowRight aria-hidden className="size-4" />
              </Link>
            </div>
          )}
          {market.last_error && <p className="text-[13px] text-fail">Last attempt not settled: {market.last_error}</p>}
        </div>
      </div>
    </Panel>
  );
}
