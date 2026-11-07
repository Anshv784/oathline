import { ArrowLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Hash, Label, Notice, Panel, PassMark, Skeleton, formatTime } from "../components/ui";
import { useLoad } from "../lib/useLoad";
import { PREVIEW, checkResponse, getRequest, type CheckView, type RequestView } from "../lib/verdict";
import { base64ToBytes, bytesToBase64, requestBody, verifyResponse, type Report } from "../lib/verify";
import { OutcomeTag, headline } from "./Ledger";

/** What each check means, in plain words. Keyed by the check ids in verify.ts. */
const MEANING: Record<string, string> = {
  request: "Nobody changed the question after the contract wrote it.",
  kind: "The signature came from the AI's sealed machine, not from an ordinary server.",
  text: "The signature is for this exact question and this exact answer.",
  signer: "It is the same AI key the contract accepted after checking its Intel certificate.",
  answer: "The AI picked one of the answers the contract allowed.",
};

export function VerdictPage() {
  const { id = "" } = useParams();
  const [request, retry] = useLoad((signal) => getRequest(id, signal), `request-${id}`);

  return (
    <div className="space-y-8">
      <Link to="/" className="-ml-2 inline-flex items-center gap-1 rounded px-2 py-1.5 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> All verdicts
      </Link>

      {request.state === "loading" && (
        <div className="space-y-6">
          <Skeleton className="h-28" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
        </div>
      )}
      {request.state === "error" && (
        <Notice tone="fail" title="Couldn't read this verdict" action={<Button variant="outline" onClick={retry}>Try again</Button>}>
          {request.message}
        </Notice>
      )}
      {request.state === "ready" && request.data === null && (
        <Notice title={`There is no request #${id}`} action={<Link className="underline underline-offset-4" to="/">Back to all verdicts</Link>} />
      )}
      {request.state === "ready" && request.data && <Verdict request={request.data} />}
    </div>
  );
}

function Verdict({ request }: { request: RequestView }) {
  const response = request.response_base64 ? base64ToBytes(request.response_base64) : null;
  const report = useMemo(
    () =>
      response && request.signature
        ? verifyResponse(request, request.request_hash, response, request.signature, request.signer)
        : null,
    // The response bytes are derived from request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [request],
  );

  return (
    <article className="fade-in space-y-12">
      <header className="space-y-4">
        <p className="font-mono text-[13px] text-ink-2">
          Request #{request.id} · asked by {request.requester} · {formatTime(request.created_at_ms)}
        </p>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight md:text-[32px]">{headline(request)}</h1>

        {request.outcome.status === "answered" && (
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[15px] text-ink-2">The AI answered</span>
              <OutcomeTag outcome={request.outcome} />
            </div>
            <p className="max-w-3xl basis-full text-[17px] leading-relaxed md:flex-1 md:basis-0">“{request.outcome.reason}”</p>
          </div>
        )}
        {request.outcome.status === "failed" && (
          <p className="max-w-3xl text-[17px] leading-relaxed">
            The contract refused the AI's answer: <span className="text-fail">{request.outcome.reason}</span>
          </p>
        )}
        {request.outcome.status === "pending" && <p className="text-[17px]">Waiting for the AI's answer.</p>}

        {report && <Seal accepted={report.accepted} />}
      </header>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel className="p-5">
          <h2 className="font-semibold">The question</h2>
          <p className="mt-1 text-[13px] text-ink-2">Written by the Verdict contract, word for word, before the AI saw it.</p>
          <div className="mt-5 space-y-5">
            <TextBlock label="The rule" text={request.instructions} />
            <TextBlock label="What was submitted" text={request.submission} />
            <div>
              <Label>Allowed answers</Label>
              <p className="mt-2 font-mono text-[13px]">{request.options.join("  ·  ")}</p>
            </div>
          </div>
        </Panel>
        {report ? <Checks report={report} /> : <Panel className="p-5 text-sm text-ink-2">Nothing to check until the AI answers.</Panel>}
      </div>

      {response && request.signature && <TryToFake request={request} original={response} />}

      <Technical request={request} />
    </article>
  );
}

function Seal({ accepted }: { accepted: boolean }) {
  return (
    <div className={`flex max-w-3xl gap-3 rounded-md p-4 ${accepted ? "bg-pass-wash" : "bg-fail-wash"}`}>
      <PassMark passed={accepted} />
      <p className="text-[14px] leading-relaxed">
        {accepted ? (
          <>
            <span className="font-medium text-pass">Verified.</span> This answer was signed inside NEAR AI's sealed machine, for
            exactly this question. The contract checked that on chain, and your browser just checked it again.
          </>
        ) : (
          <>
            <span className="font-medium text-fail">Not verified.</span> Your browser could not confirm this answer. See the checks
            below.
          </>
        )}
      </p>
    </div>
  );
}

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="mt-2 max-w-prose whitespace-pre-wrap text-[15px] leading-relaxed">{text}</p>
    </div>
  );
}

function Checks({ report }: { report: Report }) {
  return (
    <Panel>
      <div className="border-b border-rule px-5 py-4">
        <h2 className="font-semibold">{report.checks.length} checks, redone in your browser</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          Separate code from the contract's, so you don't have to trust either one alone. Open a check to see the values.
        </p>
      </div>
      <ol className="divide-y divide-rule">
        {report.checks.map((check) => (
          <li key={check.id}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-3.5 hover:bg-paper [&::-webkit-details-marker]:hidden">
                <PassMark passed={check.passed} />
                <span className="flex-1">
                  <span className="block text-[14px] font-medium leading-5">{check.passed ? check.label : check.failure}</span>
                  {MEANING[check.id] && <span className="mt-0.5 block text-[13px] leading-5 text-ink-2">{MEANING[check.id]}</span>}
                </span>
                <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2 transition-transform group-open:rotate-90" />
              </summary>
              <dl className="space-y-2 px-5 pb-4 pl-13">
                {check.detail.map((row) => (
                  <div key={row.name}>
                    <dt className="text-[12px] text-ink-2">{row.name}</dt>
                    <dd className="break-all font-mono text-[12px] leading-5">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </li>
        ))}
      </ol>
      <p className="border-t border-rule px-5 py-3 text-[12px] leading-5 text-ink-2">
        The AI key was accepted only after its Intel certificate was checked on chain.{" "}
        <Link className="underline underline-offset-4 hover:text-ink" to="/models">See the trusted model</Link>.
      </p>
    </Panel>
  );
}

// The answer sits JSON-escaped inside the response's content string, with or
// without a space after the colon depending on the model.
const ANSWER_FIELD = /(\\"answer\\":\s*\\")([A-Z0-9_]+)(\\")/;

function TryToFake({ request, original }: { request: RequestView; original: Uint8Array }) {
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
    <section aria-labelledby="fake-heading" className="border-t border-rule pt-10">
      <h2 id="fake-heading" className="text-[20px] font-semibold tracking-tight">Try to fake it</h2>
      <p className="mt-1 max-w-prose text-[15px] leading-relaxed text-ink-2">
        Pretend you're the one carrying the AI's answer to the contract, and you want a different result. Change the answer,
        then check it. Your browser and the live contract will both refuse it.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Panel className="p-5">
            <p className="text-[13px] text-ink-2">The answer in the signed response is now</p>
            <p className="mt-1 font-mono text-[22px] font-medium">{current ?? "—"}</p>
            {changed && <p className="mt-1 text-[13px] text-wait">Changed from the original.</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant={changed ? "outline" : "solid"} onClick={flip} disabled={!current || !next}>
                1. Change it to {next ?? "…"}
              </Button>
              <Button variant={changed ? "solid" : "outline"} onClick={run} disabled={checking}>
                {checking ? "Checking…" : "2. Check it"}
              </Button>
              <Button variant="outline" onClick={() => edit(originalText)} disabled={!changed}>
                Reset
              </Button>
            </div>
          </Panel>
          <details className="group rounded-md border border-rule bg-surface">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm hover:bg-paper [&::-webkit-details-marker]:hidden">
              <ChevronRight aria-hidden className="size-4 text-ink-2 transition-transform group-open:rotate-90" />
              Or edit the raw response yourself
            </summary>
            <div className="border-t border-rule p-3">
              <label htmlFor="draft" className="sr-only">Raw response</label>
              <textarea
                id="draft"
                value={draft}
                onChange={(event) => edit(event.target.value)}
                spellCheck={false}
                rows={8}
                className="w-full resize-y rounded border border-rule-strong bg-paper p-3 font-mono text-[12px] leading-5"
              />
            </div>
          </details>
        </div>

        <div aria-live="polite" className="space-y-3">
          {!browser && (
            <p className="rounded-md border border-dashed border-rule-strong p-5 text-[14px] text-ink-2">
              Results show here after you press Check.
            </p>
          )}
          {browser && (
            <Result
              who="Your browser"
              accepted={browser.accepted}
              detail={browser.accepted ? `Accepted. Answer: ${browser.answer?.answer}` : browser.checks.find((c) => !c.passed)?.failure ?? ""}
            />
          )}
          {browser && !PREVIEW && contract === null && checking && <Skeleton className="h-16" />}
          {contract === "error" && <Result who="The contract" accepted={false} detail="Couldn't reach the contract to ask it." />}
          {contract && contract !== "error" && (
            <Result
              who="The live contract"
              accepted={contract.accepted}
              detail={contract.accepted ? `Accepted. Answer: ${contract.answer}` : contract.error ?? ""}
            />
          )}
          {browser && (
            <p className="text-[14px] leading-relaxed">
              {browser.accepted
                ? "This is the original, unchanged answer, so it matches the signature."
                : "The signature was made for the original answer only. Any change breaks it, which is what stops a middleman from lying to the contract."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Result({ who, accepted, detail }: { who: string; accepted: boolean; detail: string }) {
  return (
    <div className={`fade-in flex gap-3 rounded-md p-4 ${accepted ? "bg-pass-wash" : "bg-fail-wash"}`}>
      <PassMark passed={accepted} />
      <div className="min-w-0">
        <p className={`text-sm font-medium ${accepted ? "text-pass" : "text-fail"}`}>
          {who}: {accepted ? "accepted" : "refused"}
        </p>
        <p className="mt-0.5 break-words text-[13px] text-ink">{detail}</p>
      </div>
    </div>
  );
}

function Technical({ request }: { request: RequestView }) {
  const body = requestBody(request);
  const response = request.response_base64 ? new TextDecoder().decode(base64ToBytes(request.response_base64)) : "";
  return (
    <section aria-labelledby="tech-heading" className="space-y-3 border-t border-rule pt-10">
      <div>
        <h2 id="tech-heading" className="text-[20px] font-semibold tracking-tight">Technical details</h2>
        <p className="mt-1 max-w-prose text-[14px] text-ink-2">
          The exact bytes stored on chain. With these, anyone can redo every check without this website.
        </p>
      </div>
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
        <Meta term="Model" value={request.model} />
        <Meta term="Asked" value={formatTime(request.created_at_ms)} />
        <Meta term="Answered" value={formatTime(request.answered_at_ms)} />
        {request.completion_id && <Meta term="NEAR AI completion" value={request.completion_id} />}
      </dl>
      <RawItem title="Request sent to the AI" value={body} />
      {response && <RawItem title="Raw response from NEAR AI" value={response} />}
      {request.signature && <RawItem title="Signature from the sealed machine" value={JSON.stringify(request.signature, null, 2)} />}
      <div className="flex flex-wrap items-center gap-x-3 pt-1 text-[13px] text-ink-2">
        Question fingerprint (sha256) <Hash value={request.request_hash} />
      </div>
    </section>
  );
}

function Meta({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-ink-2">{term}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

function RawItem({ title, value }: { title: string; value: string }) {
  return (
    <details className="group rounded-md border border-rule bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm hover:bg-paper [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-4 text-ink-2 transition-transform group-open:rotate-90" />
        {title}
        <span className="ml-auto font-mono text-[12px] text-ink-2">{new TextEncoder().encode(value).length} bytes</span>
      </summary>
      <pre className="max-h-80 overflow-auto border-t border-rule px-4 py-3 font-mono text-[12px] leading-5 whitespace-pre-wrap break-all">
        {value}
      </pre>
    </details>
  );
}
