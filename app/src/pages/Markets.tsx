import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Hash, Label, Notice, Skeleton, Tag, formatDate, formatTime, roman } from "../components/ui";
import { MARKET, getSource, listMarkets, near, type Market } from "../lib/market";
import { useLoad } from "../lib/useLoad";

export function Markets() {
  const [markets, retry] = useLoad(listMarkets, "markets");

  return (
    <div className="space-y-14">
      <section className="grid gap-8 md:grid-cols-12">
        <div className="md:col-span-7">
          <Label>Example contract · {MARKET ?? "not configured"}</Label>
          <h1 className="serif mt-3 text-[40px] leading-[1.05] tracking-tight md:text-[52px]">
            A prediction market with <span className="italic text-seal">no token vote</span>.
          </h1>
        </div>
        <div className="space-y-4 text-[15px] leading-relaxed text-ink-2 md:col-span-5 md:pt-8">
          <p>
            People bet NEAR on YES or NO. When it closes, Oathline rules YES, NO or INVALID under the market's written rules.
            Winners split the pot; INVALID refunds everyone. No whale can outvote the evidence.
          </p>
          <p>
            <span className="text-ink">Fixed-source markets</span> go one step further: the creator pins a URL up front, and at
            resolution a sealed OutLayer worker fetches that page itself. Nobody gets to type the evidence.
          </p>
        </div>
      </section>

      {!MARKET && <Notice title="No market contract configured">Set VITE_MARKET_CONTRACT to read one.</Notice>}
      {markets.state === "loading" && MARKET && <Skeleton className="h-72" />}
      {markets.state === "error" && (
        <Notice tone="fail" title="Couldn't read the markets" action={<Button variant="outline" onClick={retry}>Try again</Button>}>
          {markets.message}
        </Notice>
      )}
      {markets.state === "ready" && (
        <ol className="border-t-2 border-ink">
          {markets.data.map((market) => (
            <MarketRow key={market.id} market={market} />
          ))}
        </ol>
      )}
    </div>
  );
}

function MarketRow({ market }: { market: Market }) {
  const [source] = useLoad((signal) => getSource(market.id, signal), `source-${market.id}`);
  const resolved = market.status.status === "resolved" ? market.status : null;
  const tone = resolved ? (resolved.outcome === "INVALID" ? "wait" : "pass") : market.status.status === "resolving" ? "wait" : "plain";
  const fixed = source.state === "ready" && source.data ? source.data : null;

  return (
    <li className="grid gap-6 border-b border-rule py-8 md:grid-cols-12">
      <div className="md:col-span-5">
        <div className="flex flex-wrap items-center gap-3 font-mono text-[12px] text-ink-3">
          <span>MARKET {roman(Number(market.id) + 1)}</span>
          <Tag tone={tone}>{resolved ? resolved.outcome : market.status.status.toUpperCase()}</Tag>
          {fixed && <Tag tone="seal">FIXED SOURCE</Tag>}
        </div>
        <h2 className="serif mt-3 text-[24px] leading-snug">{market.question}</h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">{market.rules}</p>
        <dl className="mt-4 grid grid-cols-3 gap-2 font-mono text-[12.5px]">
          <div><dt className="text-ink-3">YES</dt><dd>{near(market.yes_pool)}</dd></div>
          <div><dt className="text-ink-3">NO</dt><dd>{near(market.no_pool)}</dd></div>
          <div><dt className="text-ink-3">Closed</dt><dd>{formatDate(market.closes_at_ms)}</dd></div>
        </dl>
      </div>

      <div className="space-y-5 md:col-span-7 md:border-l md:border-rule md:pl-8">
        {fixed && (
          <div>
            <Label>Exhibit · fetched inside a TDX worker</Label>
            <a href={fixed[0].url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 break-all font-mono text-[13px] text-seal underline underline-offset-4">
              {fixed[0].url} <ArrowUpRight aria-hidden className="size-3.5 shrink-0" />
            </a>
            <p className="mt-1 text-[13px] text-ink-2">
              Pinned when the market was created, with the anchor “{fixed[0].anchor}”.
              {fixed[1] && <> Fetched {formatTime(fixed[1].fetched_at_ms)}, {fixed[1].bytes.toLocaleString()} bytes.</>}
            </p>
            {fixed[1] && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
                Page SHA-256 <Hash value={fixed[1].sha256} />
              </p>
            )}
          </div>
        )}
        <div>
          <Label>{fixed ? "What the fetcher returned" : `Evidence posted${market.resolver ? ` by ${market.resolver}` : ""}`}</Label>
          <p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap border-l-2 border-rule-strong pl-4 text-[14px] leading-relaxed [overflow-wrap:anywhere]">
            {market.evidence ? market.evidence.replace(/^Source:[^\n]*\n[^\n]*\n\n/, "") : "None yet."}
          </p>
        </div>
        {resolved && (
          <div>
            <Label>Ruling</Label>
            <p className="serif mt-2 text-[19px] italic leading-snug">“{resolved.reason}”</p>
            <Link to={`/v/${resolved.verdict_request}`} className="mt-2 inline-flex items-center gap-1 text-[13.5px] text-seal underline underline-offset-4">
              Read the sworn record No. {String(resolved.verdict_request).padStart(3, "0")} <ArrowUpRight aria-hidden className="size-3.5" />
            </Link>
          </div>
        )}
        {market.last_error && <p className="text-[13px] text-fail">Last attempt did not settle: {market.last_error}</p>}
      </div>
    </li>
  );
}
