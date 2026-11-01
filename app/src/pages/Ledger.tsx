import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Notice, Skeleton, Tag, formatTime } from "../components/ui";
import { useLoad } from "../lib/useLoad";
import { listRequests, type Outcome, type RequestView } from "../lib/verdict";

export function OutcomeTag({ outcome }: { outcome: Outcome }) {
  if (outcome.status === "answered") return <Tag tone="pass">{outcome.answer}</Tag>;
  if (outcome.status === "failed") return <Tag tone="fail">REFUSED</Tag>;
  return <Tag tone="wait">PENDING</Tag>;
}

/** The first line of a submission, for the list. */
const headline = (request: RequestView) =>
  request.submission.split("\n").find((line) => line.trim())?.replace(/^Title:\s*/, "") ?? "";

export function Ledger() {
  const [requests, retry] = useLoad(listRequests, "requests");

  return (
    <div className="space-y-10">
      <section className="max-w-3xl">
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">
          A contract can't take an AI's word for it. Verdict checks.
        </h1>
        <p className="mt-3 max-w-prose text-[15px] leading-relaxed text-ink-2">
          Each answer below was accepted by a NEAR contract only after it verified, on chain, that a NEAR AI model running in
          an attested Intel TDX enclave signed exactly this question and this answer. Open one to recompute the checks
          yourself.
        </p>
      </section>

      <section aria-labelledby="ledger-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="ledger-heading" className="text-sm font-semibold">
            Recent verdicts
          </h2>
          {requests.state === "ready" && <span className="font-mono text-[12px] text-ink-2">{requests.data.length} shown</span>}
        </div>

        {requests.state === "loading" && (
          <div className="space-y-px overflow-hidden rounded-md border border-rule">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 bg-surface px-4 py-4">
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        )}

        {requests.state === "error" && (
          <Notice tone="fail" title="Couldn't read the contract" action={<Button variant="outline" onClick={retry}>Try again</Button>}>
            {requests.message}
          </Notice>
        )}

        {requests.state === "ready" && requests.data.length === 0 && (
          <Notice title="No questions asked yet">
            Once a model is registered, any contract can call <code className="font-mono">ask</code>. See{" "}
            <Link className="underline underline-offset-4" to="/how">how it works</Link>.
          </Notice>
        )}

        {requests.state === "ready" && requests.data.length > 0 && (
          <ol className="divide-y divide-rule overflow-hidden rounded-md border border-rule bg-surface">
            {requests.data.map((request) => (
              <li key={request.id}>
                <Link
                  to={`/v/${request.id}`}
                  className="group grid grid-cols-[3rem_1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 hover:bg-paper md:grid-cols-[3rem_1fr_14rem_auto_1.25rem]"
                >
                  <span className="font-mono text-[13px] text-ink-2">#{request.id}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium">{headline(request)}</span>
                    <span className="block truncate font-mono text-[12px] text-ink-2">
                      {request.requester} · {formatTime(request.created_at_ms)}
                    </span>
                  </span>
                  <span className="hidden truncate font-mono text-[12px] text-ink-2 md:block">{request.model}</span>
                  <OutcomeTag outcome={request.outcome} />
                  <ArrowRight aria-hidden className="hidden size-4 text-ink-2 transition-transform group-hover:translate-x-0.5 md:block" />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
