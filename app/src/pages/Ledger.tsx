import { ArrowRight, FileCheck2, Repeat, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Label, Notice, Panel, Skeleton, Tag, buttonClass, formatTime } from "../components/ui";
import { useLoad } from "../lib/useLoad";
import { listRequests, type Outcome, type RequestView } from "../lib/verdict";

export function OutcomeTag({ outcome }: { outcome: Outcome }) {
  if (outcome.status === "answered") {
    const tone = outcome.answer === "REJECT" ? "fail" : outcome.answer === "INVALID" ? "wait" : "pass";
    return <Tag tone={tone}>{outcome.answer}</Tag>;
  }
  if (outcome.status === "failed") return <Tag tone="fail">REFUSED</Tag>;
  return <Tag tone="wait">PENDING</Tag>;
}

/** A market's question, or else the submission's title. */
export const headline = (request: RequestView) =>
  request.instructions.match(/^Question: (.+)$/m)?.[1] ??
  request.submission.split("\n").find((line) => line.trim())?.replace(/^Title:\s*/, "") ??
  "";

/** Which example contract asked, in plain words. */
export const source = (request: RequestView) =>
  request.requester.startsWith("charter-dao.")
    ? "Grant DAO"
    : request.requester.startsWith("market.")
      ? "Prediction market"
      : request.requester;

const stops = [
  {
    icon: FileCheck2,
    title: "Faking the answer",
    text: "The AI signs every answer inside a sealed machine. Change one letter and the contract refuses it.",
  },
  {
    icon: ShieldCheck,
    title: "Swapping the AI",
    text: "Only a model that proved, with an Intel certificate checked on chain, that it runs in a sealed machine is accepted.",
  },
  {
    icon: Repeat,
    title: "Asking until it's lucky",
    text: "The question is sent exactly once, from a sealed worker. Nobody can re-ask and keep the answer they like.",
  },
];

const flow = [
  ["A contract asks", "For example: does this proposal fit our rules? APPROVE or REJECT."],
  ["Verdict writes the question", "It fixes the exact wording itself and stores its fingerprint on chain."],
  ["A sealed worker asks NEAR AI once", "An OutLayer worker sends it to the AI and brings back the signed answer."],
  ["Verdict checks, then replies", "Right signature, right question, allowed answer: only then does the contract get it."],
];

export function Ledger() {
  const [requests, retry] = useLoad(listRequests, "requests");
  const first = requests.state === "ready" ? requests.data[0] : undefined;

  return (
    <div className="space-y-16">
      <section className="max-w-3xl">
        <h1 className="text-[30px] font-semibold leading-tight tracking-tight md:text-[40px]">
          AI answers a smart contract can check for itself.
        </h1>
        <p className="mt-4 max-w-prose text-[16px] leading-relaxed text-ink-2">
          Smart contracts can't run AI, so someone has to fetch the answer and hand it over, and that person could lie.
          Verdict makes the contract check the AI's proof itself, so nobody in the middle has to be trusted.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {first && (
            <Link to={`/v/${first.id}`} className={buttonClass()}>
              See a live verdict <ArrowRight aria-hidden className="size-4" />
            </Link>
          )}
          <Link to="/how" className={buttonClass("outline")}>
            How it works
          </Link>
        </div>
      </section>

      <section aria-labelledby="stops-heading">
        <h2 id="stops-heading" className="text-[20px] font-semibold tracking-tight">What Verdict stops</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {stops.map(({ icon: Icon, title, text }) => (
            <Panel key={title} className="p-5">
              <Icon aria-hidden className="size-5 text-ink-2" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{text}</p>
            </Panel>
          ))}
        </div>
      </section>

      <section aria-labelledby="flow-heading">
        <h2 id="flow-heading" className="text-[20px] font-semibold tracking-tight">What happens when a contract asks</h2>
        <ol className="mt-4 grid gap-px overflow-hidden rounded-md border border-rule bg-rule md:grid-cols-4">
          {flow.map(([title, text], index) => (
            <li key={title} className="bg-surface p-5">
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-ink font-mono text-[13px] text-paper">
                {index + 1}
              </span>
              <h3 className="mt-3 font-semibold leading-snug">{title}</h3>
              <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[13px] text-ink-2">
          All four steps happen from one transaction, in about 25 seconds, for about 0.0016 NEAR of compute.
        </p>
      </section>

      <section aria-labelledby="ledger-heading" className="space-y-4">
        <div>
          <h2 id="ledger-heading" className="text-[20px] font-semibold tracking-tight">Two contracts already use it</h2>
          <p className="mt-1 max-w-prose text-[15px] leading-relaxed text-ink-2">
            Two different example contracts on NEAR testnet call the same Verdict contract. Every answer below is real.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel className="p-5">
            <Label>Grant DAO · charter-dao</Label>
            <p className="mt-2 text-[15px] leading-relaxed">
              Funds only open-source NEAR tools. Every proposal is screened against the DAO's rule before it can reach a vote.
            </p>
          </Panel>
          <Link to="/markets" className="group block rounded-md border border-rule bg-surface p-5 hover:bg-paper">
            <Label>Prediction market · verdict-market</Label>
            <p className="mt-2 text-[15px] leading-relaxed">
              People bet YES or NO. After it closes, Verdict decides from the rules and the posted evidence. No token vote.
            </p>
            <span className="mt-2 inline-flex items-center gap-1 text-[13px] text-ink-2 group-hover:text-ink">
              See the markets <ArrowRight aria-hidden className="size-4" />
            </span>
          </Link>
        </div>

        {requests.state === "loading" && (
          <div className="space-y-px overflow-hidden rounded-md border border-rule">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-4 bg-surface px-5 py-5">
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
            <Link className="underline underline-offset-4" to="/developers">how to use it</Link>.
          </Notice>
        )}

        {requests.state === "ready" && requests.data.length > 0 && (
          <ol className="divide-y divide-rule overflow-hidden rounded-md border border-rule bg-surface">
            {requests.data.map((request) => (
              <li key={request.id}>
                <Link to={`/v/${request.id}`} className="group flex items-start gap-4 px-5 py-4 hover:bg-paper">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[16px] font-medium">{headline(request)}</span>
                      <OutcomeTag outcome={request.outcome} />
                    </div>
                    {request.outcome.status === "answered" && (
                      <p className="mt-1 line-clamp-2 max-w-prose text-[14px] leading-relaxed text-ink-2">{request.outcome.reason}</p>
                    )}
                    <p className="mt-1.5 font-mono text-[12px] text-ink-2">
                      #{request.id} · {source(request)} · {formatTime(request.created_at_ms)}
                    </p>
                  </div>
                  <span className="mt-1 hidden shrink-0 items-center gap-1 text-[13px] text-ink-2 group-hover:text-ink sm:inline-flex">
                    Check the proof <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
