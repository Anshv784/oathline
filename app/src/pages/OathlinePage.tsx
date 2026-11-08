import { ArrowLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Seal } from "../components/brand";
import { Button, Hash, Label, Notice, PassMark, Skeleton, formatTime, roman } from "../components/ui";
import { useLoad } from "../lib/useLoad";
import { PREVIEW, checkResponse, getRequest, type CheckView, type RequestView } from "../lib/oathline";
import { base64ToBytes, bytesToBase64, requestBody, verifyResponse, type Report } from "../lib/verify";
import { OutcomeTag, headline, source } from "./Ledger";

/** What each check means, in plain words. Keyed by the check ids in verify.ts. */
const MEANING: Record<string, string> = {
  request: "Nobody reworded the question after the contract wrote it.",
  kind: "The signature came from the AI's sealed machine, not an ordinary server.",
  text: "Change one byte of either, and it no longer matches.",
  signer: "It is the key the contract pinned after checking the Intel quote on chain.",
  answer: "The AI chose one of the answers the contract allowed.",
};

export function OathlinePage() {
  const { id = "" } = useParams();
  const [request, retry] = useLoad((signal) => getRequest(id, signal), `request-${id}`);

  return (
    <div className="space-y-10">
      <Link to="/" className="inline-flex items-center gap-1.5 text-[13.5px] text-ink-2 hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> The record
      </Link>

      {request.state === "loading" && <Skeleton className="h-96" />}
      {request.state === "error" && (
        <Notice tone="fail" title="Couldn't read this record" action={<Button variant="outline" onClick={retry}>Try again</Button>}>
          {request.message}
        </Notice>
      )}
      {request.state === "ready" && request.data === null && (
        <Notice title={`There is no record No. ${id}`} action={<Link className="underline underline-offset-4" to="/">Back to the record</Link>} />
      )}
      {request.state === "ready" && request.data && <Record request={request.data} />}
    </div>
  );
}

function Record({ request }: { request: RequestView }) {
  const response = request.response_base64 ? base64ToBytes(request.response_base64) : null;
  const report = useMemo(
    () => (response && request.signature ? verifyResponse(request, request.request_hash, response, request.signature, request.signer) : null),
    // The response bytes are derived from request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [request],
  );
  const answered = request.outcome.status === "answered" ? request.outcome : null;

  return (
    <article className="fade-in">
      {/* The sheet */}
      <div className="border border-rule bg-sheet px-5 py-8 md:px-12 md:py-12">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink pb-3 font-mono text-[12px] text-ink-2">
          <span>RECORD No. {String(request.id).padStart(3, "0")}</span>
          <span>{source(request)} · {request.requester}</span>
          <span>{formatTime(request.created_at_ms)}</span>
        </div>

        <div className="mt-8 grid gap-8 md:grid-cols-[1fr_auto]">
          <div>
            <Label>In the matter of</Label>
            <h1 className="serif mt-2 text-[34px] leading-[1.1] tracking-tight md:text-[44px]">{headline(request)}</h1>

            {answered && (
              <div className="mt-8">
                <div className="flex items-center gap-3">
                  <Label>Ruling</Label>
                  <OutcomeTag outcome={request.outcome} />
                </div>
                <blockquote className="serif mt-4 border-l-2 border-seal pl-5 text-[21px] italic leading-relaxed md:text-[23px]">
                  “{answered.reason}”
                </blockquote>
                <p className="mt-3 pl-5 text-[13px] text-ink-3">Testimony of {request.model}, given once inside an Intel TDX enclave.</p>
              </div>
            )}
            {request.outcome.status === "failed" && (
              <p className="mt-8 text-[17px]">
                The contract refused the answer: <span className="text-fail">{request.outcome.reason}</span>
              </p>
            )}
            {request.outcome.status === "pending" && <p className="mt-8 text-[17px] text-ink-2">Awaiting the model's answer.</p>}
          </div>

          {report && (
            <div className="flex flex-col items-center justify-start md:pt-6">
              <Seal label={report.accepted ? "UPHELD" : "NOT PROVEN"} tone={report.accepted ? "seal" : "fail"} size={150} />
              <p className={`mt-3 max-w-[12rem] text-center text-[12.5px] leading-snug ${report.accepted ? "text-seal" : "text-fail"}`}>
                {report.accepted ? "Proven on chain, and re-proven in your browser just now." : "Your browser could not confirm this answer."}
              </p>
            </div>
          )}
        </div>

        {/* The matter */}
        <div className="mt-12 grid gap-8 border-t border-rule pt-8 md:grid-cols-2">
          <TextBlock label="The rule" text={request.instructions} />
          <TextBlock label="What was put before it" text={request.submission} />
        </div>
        <p className="mt-6 font-mono text-[12.5px] text-ink-2">
          Allowed answers: {request.options.join(" · ")} — written by the contract, word for word, before the AI saw it.
        </p>

        {report && <Examination report={report} />}
      </div>

      {response && request.signature && <CrossExamination request={request} original={response} />}

      <Exhibits request={request} />
    </article>
  );
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="mt-2 max-w-prose whitespace-pre-wrap text-[15.5px] leading-relaxed [overflow-wrap:anywhere]">{text}</p>
    </div>
  );
}

function Examination({ report }: { report: Report }) {
  return (
    <section aria-labelledby="exam" className="mt-12 border-t border-ink pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="exam" className="serif text-[24px]">Examination</h2>
        <p className="text-[13px] text-ink-2">{report.checks.length} checks, redone in your browser by code separate from the contract's.</p>
      </div>
      <ol className="mt-4">
        {report.checks.map((check, i) => (
          <li key={check.id} className="border-b border-rule last:border-b-0">
            <details className="group">
              <summary className="grid cursor-pointer list-none grid-cols-[2rem_1.5rem_1fr_1rem] items-start gap-2 py-3.5 [&::-webkit-details-marker]:hidden">
                <span className="serif pt-0.5 text-[14px] italic text-ink-3">{roman(i + 1)}.</span>
                <PassMark passed={check.passed} />
                <span>
                  <span className="block text-[15px] font-medium">{check.passed ? check.label : check.failure}</span>
                  {MEANING[check.id] && <span className="mt-0.5 block text-[13.5px] text-ink-2">{MEANING[check.id]}</span>}
                </span>
                <ChevronRight aria-hidden className="mt-1 size-4 text-ink-3 transition-transform group-open:rotate-90" />
              </summary>
              <dl className="space-y-2 pb-4 pl-[4.5rem]">
                {check.detail.map((row) => (
                  <div key={row.name}>
                    <dt className="text-[12px] text-ink-3">{row.name}</dt>
                    <dd className="break-all font-mono text-[12px] leading-5">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[13px] text-ink-2">
        The signing key itself was admitted only after its Intel TDX quote was verified on chain.{" "}
        <Link className="text-seal underline underline-offset-4" to="/models">See the sworn model</Link>.
      </p>
    </section>
  );
}

// The answer sits JSON-escaped inside the response's content string, with or
// without a space after the colon depending on the model.
const ANSWER_FIELD = /(\\"answer\\":\s*\\")([A-Z0-9_]+)(\\")/;

function CrossExamination({ request, original }: { request: RequestView; original: Uint8Array }) {
  const originalText = useMemo(() => new TextDecoder().decode(original), [original]);
  const [draft, setDraft] = useState(originalText);
  const [browser, setBrowser] = useState<Report | null>(null);
  const [contract, setContract] = useState<CheckView | null | "error">(null);
  const [checking, setChecking] = useState(false);

  const current = draft.match(ANSWER_FIELD)?.[2];
  const next = request.options.find((option) => option !== current);
  const changed = draft !== originalText;

  const edit = (text: string) => {
    setDraft(text);
    setBrowser(null);
    setContract(null);
  };
  const flip = () => {
    if (current && next) edit(draft.replace(ANSWER_FIELD, `$1${next}$3`));
  };
  const run = async () => {
    const bytes = new TextEncoder().encode(draft);
    setBrowser(verifyResponse(request, request.request_hash, bytes, request.signature!, request.signer));
    if (PREVIEW) return;
    setChecking(true);
    setContract(null);
    try {
      setContract(await checkResponse(request.id, bytesToBase64(bytes), request.signature!));
    } catch {
      setContract("error");
    } finally {
      setChecking(false);
    }
  };

  return (
    <section aria-labelledby="cross" className="mt-16 grid gap-8 md:grid-cols-12">
      <div className="md:col-span-5">
        <h2 id="cross" className="serif text-[28px] leading-tight">Cross-examination</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
          You are the one carrying this answer to the contract, and you want a different ruling. Change it, then present it.
          The signature was made for the original words only.
        </p>
        <div className="mt-6 border-y border-rule py-4">
          <div className="text-[13px] text-ink-2">The answer you are presenting</div>
          <div className="serif mt-1 text-[32px] leading-none">{current ?? "—"}</div>
          {changed && <div className="mt-1 text-[13px] text-wait">altered from the original</div>}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant={changed ? "outline" : "solid"} onClick={flip} disabled={!current || !next}>
            I. Change it to {next ?? "…"}
          </Button>
          <Button variant={changed ? "solid" : "outline"} onClick={run} disabled={checking}>
            {checking ? "Presenting…" : "II. Present it"}
          </Button>
          <Button variant="outline" onClick={() => edit(originalText)} disabled={!changed}>
            Reset
          </Button>
        </div>
        <details className="group mt-5">
          <summary className="cursor-pointer list-none text-[13px] text-ink-2 underline underline-offset-4 [&::-webkit-details-marker]:hidden">
            Or alter the raw bytes yourself
          </summary>
          <label htmlFor="draft" className="sr-only">Raw response</label>
          <textarea
            id="draft"
            value={draft}
            onChange={(event) => edit(event.target.value)}
            spellCheck={false}
            rows={8}
            className="mt-3 w-full resize-y border border-rule-strong bg-sheet p-3 font-mono text-[12px] leading-5"
          />
        </details>
      </div>

      <div aria-live="polite" className="md:col-span-7 md:border-l md:border-rule md:pl-8">
        {!browser && (
          <p className="serif text-[19px] italic text-ink-3">The court has not heard your version yet.</p>
        )}
        {browser && (
          <div className="space-y-4">
            <Finding who="Your browser" accepted={browser.accepted} detail={browser.accepted ? `Accepted: ${browser.answer?.answer}` : browser.checks.find((c) => !c.passed)?.failure ?? ""} />
            {!PREVIEW && contract === null && checking && <Skeleton className="h-14" />}
            {contract === "error" && <Finding who="The contract" accepted={false} detail="Couldn't reach the contract to ask it." />}
            {contract && contract !== "error" && (
              <Finding who="The live contract (check_response)" accepted={contract.accepted} detail={contract.accepted ? `Accepted: ${contract.answer}` : contract.error ?? ""} />
            )}
            <p className="serif pt-2 text-[19px] leading-snug">
              {browser.accepted
                ? "These are the original words, so the oath holds."
                : "Refused. Any change, even one character, breaks the oath. That is what stops a middleman from lying to the contract."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Finding({ who, accepted, detail }: { who: string; accepted: boolean; detail: string }) {
  return (
    <div className={`fade-in border-l-2 py-1 pl-4 ${accepted ? "border-pass" : "border-fail"}`}>
      <p className={`font-mono text-[12.5px] tracking-wide ${accepted ? "text-pass" : "text-fail"}`}>
        {who.toUpperCase()}: {accepted ? "ACCEPTED" : "REFUSED"}
      </p>
      <p className="mt-0.5 break-words text-[14px]">{detail}</p>
    </div>
  );
}

function Exhibits({ request }: { request: RequestView }) {
  const body = requestBody(request);
  const response = request.response_base64 ? new TextDecoder().decode(base64ToBytes(request.response_base64)) : "";
  const items: [string, string][] = [["Request sent to the AI", body]];
  if (response) items.push(["Raw response from NEAR AI", response]);
  if (request.signature) items.push(["Signature from the sealed machine", JSON.stringify(request.signature, null, 2)]);
  return (
    <section aria-labelledby="exhibits" className="mt-16">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink pb-2">
        <h2 id="exhibits" className="serif text-[24px]">Exhibits</h2>
        <p className="text-[13px] text-ink-2">The exact bytes stored on chain. With these, anyone can redo every check without this site.</p>
      </div>
      {items.map(([title, value], i) => (
        <details key={title} className="group border-b border-rule">
          <summary className="grid cursor-pointer list-none grid-cols-[5rem_1fr_auto] items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
            <span className="font-mono text-[12px] text-ink-3">EXHIBIT {String.fromCharCode(65 + i)}</span>
            <span className="text-[15px]">{title}</span>
            <span className="font-mono text-[12px] text-ink-3">{new TextEncoder().encode(value).length} bytes</span>
          </summary>
          <pre className="mb-4 max-h-80 overflow-auto bg-sheet p-4 font-mono text-[12px] leading-5 whitespace-pre-wrap break-all">{value}</pre>
        </details>
      ))}
      <div className="flex flex-wrap items-center gap-x-3 pt-3 text-[13px] text-ink-2">
        Question fingerprint (sha256) <Hash value={request.request_hash} />
        {request.completion_id && <span className="font-mono text-[12px] text-ink-3">· NEAR AI completion {request.completion_id}</span>}
      </div>
    </section>
  );
}
