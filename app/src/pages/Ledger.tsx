import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Mark } from "../components/brand";
import { Button, Label, Notice, Skeleton, Tag, buttonClass, formatDate, roman } from "../components/ui";
import { useLoad } from "../lib/useLoad";
import { listModels, listRequests, type Outcome, type RequestView } from "../lib/oathline";

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

const incidents = [
  ["Mar 2025", "$7M", "A Polymarket market was swung by one UMA holder with about a quarter of the vote."],
  ["Jul 2025", "$200M+", "Bets on whether a president wore a suit were settled by a token vote."],
  ["Nov 2024", "$47K", "One message talked the Freysa AI agent out of its prize pool."],
  ["Mar 2025", "55 ETH", "Two queued fake prompts made the AIXBT agent pay an attacker."],
];

const steps = [
  ["Prove the machine", "NEAR AI's enclave answers a one-time nonce with an Intel TDX quote. The contract checks it on chain through tee-verifier, then pins the model's signing key."],
  ["Ask exactly once", "The contract writes the question itself. A hash-pinned OutLayer worker sends those bytes to NEAR AI one time. Nobody can re-ask until they like the answer."],
  ["Check the oath", "The answer counts only if the pinned key signed this exact question and this exact answer. Change one byte and the contract refuses it."],
];

export function Ledger() {
  const [requests, retry] = useLoad(listRequests, "requests");
  const [models] = useLoad(listModels, "models");
  const list = requests.state === "ready" ? requests.data : [];
  const first = list.find((r) => r.outcome.status === "answered");
  const answered = list.filter((r) => r.outcome.status === "answered").length;
  const contracts = new Set(list.map((r) => r.requester)).size;
  const model = models.state === "ready" ? models.data.find(([, m]) => m)?.[1] : null;

  return (
    <div className="space-y-24">
      {/* Title page */}
      <section className="grid items-center gap-10 md:grid-cols-12">
        <div className="md:col-span-8">
          <Label>A register of AI answers, sworn on NEAR</Label>
          <h1 className="serif mt-4 text-[44px] leading-[1.02] tracking-[-0.02em] md:text-[68px]">
            Every AI answer,
            <br />
            <span className="italic text-seal">under oath.</span>
          </h1>
          <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-ink-2">
            Smart contracts can't run AI, so someone hands them the answer, and that someone can lie, swap the model or keep
            asking until they like the result. Oathline lets a NEAR contract check for itself that a sealed NEAR AI model
            gave <em className="text-ink">exactly this answer</em> to <em className="text-ink">exactly this question</em>,
            asked once.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {first && (
              <Link to={`/v/${first.id}`} className={buttonClass()}>
                Read a sworn answer
              </Link>
            )}
            <Link to="/how" className={buttonClass("outline")}>
              How the oath is kept
            </Link>
          </div>
        </div>
        <figure className="hidden md:col-span-4 md:block">
          <div className="text-seal">
            <Mark size={300} draw />
          </div>
          <figcaption className="mt-3 max-w-[18rem] text-[13px] leading-relaxed text-ink-3">
            One line, never lifted: the seal ring, the stem, the raised hand. Nothing in between can break it.
          </figcaption>
        </figure>
      </section>

      {/* Figures, from the chain */}
      <section aria-label="Live figures" className="grid grid-cols-2 border-y border-ink md:grid-cols-4">
        {[
          [requests.state === "ready" ? String(answered) : "…", "answers sworn on testnet"],
          [requests.state === "ready" ? String(contracts) : "…", "contracts that rely on them"],
          ["175.8", "Tgas to verify the Intel quote on chain"],
          [model ? formatDate(model.expires_at_ms) : "…", "model's oath valid until"],
        ].map(([figure, label], i) => (
          <div key={label} className={`px-1 py-5 md:px-5 ${i > 0 ? "md:border-l md:border-rule" : ""} ${i % 2 ? "border-l border-rule md:border-l" : ""}`}>
            <div className="serif text-[34px] leading-none tracking-tight">{figure}</div>
            <div className="mt-2 text-[13px] text-ink-2">{label}</div>
          </div>
        ))}
      </section>

      {/* The docket */}
      <section aria-labelledby="docket">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="docket" className="serif text-[30px] tracking-tight">The record</h2>
          <p className="text-[13px] text-ink-2">Two contracts, one Oathline. Every row is a live testnet answer you can re-check.</p>
        </div>

        {requests.state === "loading" && <Skeleton className="mt-6 h-48" />}
        {requests.state === "error" && (
          <div className="mt-6">
            <Notice tone="fail" title="Couldn't read the contract" action={<Button variant="outline" onClick={retry}>Try again</Button>}>
              {requests.message}
            </Notice>
          </div>
        )}
        {requests.state === "ready" && list.length === 0 && (
          <div className="mt-6">
            <Notice title="Nothing sworn yet">Once a model is registered, any contract can call ask.</Notice>
          </div>
        )}
        {requests.state === "ready" && list.length > 0 && (
          <table className="mt-6 w-full border-collapse text-left">
            <thead>
              <tr className="smallcaps border-b border-ink font-mono text-[12px] text-ink-3">
                <th className="w-14 py-2 font-normal">No.</th>
                <th className="py-2 font-normal">Matter</th>
                <th className="w-28 py-2 font-normal">Ruling</th>
                <th className="hidden w-40 py-2 font-normal md:table-cell">Asked by</th>
                <th className="hidden w-32 py-2 font-normal sm:table-cell">Sworn</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {list.map((request) => (
                <tr key={request.id} className="group border-b border-rule align-top">
                  <td className="py-4 font-mono text-[13px] text-ink-3">{String(request.id).padStart(3, "0")}</td>
                  <td className="py-4 pr-4">
                    <Link to={`/v/${request.id}`} className="serif text-[18px] leading-snug decoration-seal/60 underline-offset-4 group-hover:underline">
                      {headline(request)}
                    </Link>
                    {request.outcome.status === "answered" && (
                      <p className="mt-1 line-clamp-1 max-w-prose text-[13.5px] text-ink-2">{request.outcome.reason}</p>
                    )}
                  </td>
                  <td className="py-4"><OutcomeTag outcome={request.outcome} /></td>
                  <td className="hidden py-4 text-[13.5px] text-ink-2 md:table-cell">{source(request)}</td>
                  <td className="hidden py-4 font-mono text-[12.5px] text-ink-2 sm:table-cell">{formatDate(request.created_at_ms)}</td>
                  <td className="py-4 text-right">
                    <Link to={`/v/${request.id}`} aria-label={`Open record ${request.id}`} className="text-ink-3 group-hover:text-seal">
                      <ArrowUpRight className="inline size-4" aria-hidden />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Why */}
      <section className="grid gap-10 md:grid-cols-12">
        <div className="md:col-span-4">
          <h2 className="serif text-[30px] leading-tight tracking-tight">Who decided the outcome?</h2>
          <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">
            Every one of these comes down to the same gap: the contract can't see what really made the decision, so it trusts
            whoever brings the answer.
          </p>
        </div>
        <ol className="md:col-span-8">
          {incidents.map(([date, figure, text], i) => (
            <li key={text} className="grid grid-cols-[2.5rem_1fr] gap-4 border-t border-rule py-4 sm:grid-cols-[2.5rem_7rem_1fr]">
              <span className="serif pt-0.5 text-[15px] italic text-seal">{roman(i + 1)}.</span>
              <span className="hidden sm:block">
                <span className="serif block text-[24px] leading-none">{figure}</span>
                <span className="mt-1 block font-mono text-[11.5px] text-ink-3">{date}</span>
              </span>
              <span className="text-[15px] leading-relaxed">
                <span className="serif mr-2 text-[20px] sm:hidden">{figure}</span>
                {text}
              </span>
            </li>
          ))}
          <li className="border-t border-ink pt-5">
            <blockquote className="serif text-[21px] italic leading-snug">
              “…the example does not yet actually verify the AI inside of the Shade Agent yet{" "}
              <span className="not-italic text-seal">(this is TODO)</span>.”
            </blockquote>
            <p className="mt-2 text-[13px] text-ink-2">NEAR's own AI-DAO example, NearDeFi/verifiable-ai-dao. Oathline is that TODO, done on chain.</p>
          </li>
        </ol>
      </section>

      {/* How, as one unbroken line */}
      <section aria-labelledby="oath">
        <h2 id="oath" className="serif text-[30px] tracking-tight">How the oath is kept</h2>
        <ol className="relative mt-8 grid gap-10 md:grid-cols-3 md:gap-8">
          <div aria-hidden className="absolute left-[7px] top-2 bottom-2 w-px bg-seal md:left-2 md:right-2 md:top-[7px] md:bottom-auto md:h-px md:w-auto" />
          {steps.map(([title, text], i) => (
            <li key={title} className="relative pl-8 md:pl-0 md:pt-8">
              <span aria-hidden className="absolute left-0 top-1 size-[15px] rounded-full border-2 border-seal bg-paper md:top-0" />
              <span className="font-mono text-[12px] text-ink-3">Step {roman(i + 1)}</span>
              <h3 className="serif mt-1 text-[22px]">{title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-10 text-[14px] text-ink-2">
          Others check NEAR AI's attestation off chain or trust an operator. Oathline verifies the Intel quote <em>on chain</em>, with no relayer in the path.{" "}
          <Link to="/how" className="text-seal underline underline-offset-4">The full mechanism →</Link>
        </p>
      </section>
    </div>
  );
}
