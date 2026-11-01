import { ArrowLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Hash, Label, Notice, Panel, PassMark, Skeleton, Tag, formatTime } from "../components/ui";
import { useLoad } from "../lib/useLoad";
import { PREVIEW, checkResponse, getRequest, type CheckView, type RequestView } from "../lib/verdict";
import { base64ToBytes, bytesToBase64, requestBody, verifyResponse, type Report } from "../lib/verify";
import { OutcomeTag } from "./Ledger";

export function VerdictPage() {
  const { id = "" } = useParams();
  const [request, retry] = useLoad((signal) => getRequest(id, signal), `request-${id}`);

  return (
    <div className="space-y-8">
      <Link to="/" className="-ml-2 inline-flex items-center gap-1 rounded px-2 py-1.5 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> All verdicts
      </Link>

      {request.state === "loading" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_26rem]">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
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
  const question = useMemo(
    () => ({
      model: request.model,
      instructions: request.instructions,
      submission: request.submission,
      options: request.options,
      tag: request.tag,
    }),
    [request],
  );
  const response = request.response_base64 ? base64ToBytes(request.response_base64) : null;
  const report =
    response && request.signature ? verifyResponse(question, request.request_hash, response, request.signature, request.signer) : null;

  return (
    <article className="fade-in space-y-10">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-[15px] text-ink-2">Request #{request.id}</h1>
          <OutcomeTag outcome={request.outcome} />
        </div>
        {request.outcome.status === "answered" && (
          <p className="max-w-3xl text-[22px] font-medium leading-snug tracking-tight md:text-[26px]">{request.outcome.reason}</p>
        )}
        {request.outcome.status === "failed" && (
          <p className="max-w-3xl text-[19px] leading-snug">
            The contract refused the answer: <span className="text-fail">{request.outcome.reason}</span>
          </p>
        )}
        {request.outcome.status === "pending" && <p className="text-[19px]">Waiting for the model's answer.</p>}
        <dl className="flex flex-wrap gap-x-8 gap-y-2 pt-1 text-[13px]">
          <Meta term="Asked by" value={request.requester} />
          <Meta term="Model" value={request.model} />
          <Meta term="Asked" value={formatTime(request.created_at_ms)} />
          <Meta term="Answered" value={formatTime(request.answered_at_ms)} />
        </dl>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="space-y-6">
          <TextBlock label="Instructions" text={request.instructions} />
          <TextBlock label="Submission" text={request.submission} />
          <div>
            <Label>Allowed answers</Label>
            <p className="mt-2 font-mono text-[13px]">{request.options.join("  ·  ")}</p>
          </div>
          <Raw request={request} />
        </div>
        {report ? (
          <Receipt report={report} />
        ) : (
          <Panel className="order-first p-5 text-sm text-ink-2 lg:order-none">Nothing to verify until the model answers.</Panel>
        )}
      </div>

      {response && request.signature && <TamperLab request={request} original={response} />}
    </article>
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

function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="mt-2 max-w-prose whitespace-pre-wrap text-[15px] leading-relaxed">{text}</p>
    </div>
  );
}

function Receipt({ report }: { report: Report }) {
  return (
    <Panel className="order-first lg:sticky lg:top-6 lg:order-none">
      <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-4">
        <div>
          <h2 className="font-semibold">Verification</h2>
          <p className="text-[13px] text-ink-2">Recomputed in your browser, independently of the contract.</p>
        </div>
        <Tag tone={report.accepted ? "pass" : "fail"}>{report.accepted ? "ACCEPTED" : "REFUSED"}</Tag>
      </div>
      <ol className="divide-y divide-rule">
        {report.checks.map((check) => (
          <li key={check.id}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-3.5 hover:bg-paper [&::-webkit-details-marker]:hidden">
                <PassMark passed={check.passed} />
                <span className="flex-1 text-[14px] leading-5">{check.passed ? check.label : check.failure}</span>
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
        The registered key itself was admitted by proving, on chain, that it lives in an attested NEAR AI enclave.{" "}
        <Link className="underline underline-offset-4 hover:text-ink" to="/models">See the model's evidence</Link>.
      </p>
    </Panel>
  );
}

function Raw({ request }: { request: RequestView }) {
  const body = requestBody(request);
  const response = request.response_base64 ? new TextDecoder().decode(base64ToBytes(request.response_base64)) : "";
  return (
    <div className="space-y-2">
      <Label>What was signed</Label>
      <RawItem title="Request body sent to the model" value={body} />
      {response && <RawItem title="Raw response from NEAR AI" value={response} />}
      {request.signature && <RawItem title="Signature" value={JSON.stringify(request.signature, null, 2)} />}
      <div className="flex flex-wrap items-center gap-x-3 pt-1 text-[13px] text-ink-2">
        request_hash <Hash value={request.request_hash} />
      </div>
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

function TamperLab({ request, original }: { request: RequestView; original: Uint8Array }) {
  const originalText = useMemo(() => new TextDecoder().decode(original), [original]);
  const [draft, setDraft] = useState(originalText);
  const [browser, setBrowser] = useState<Report | null>(null);
  const [contract, setContract] = useState<CheckView | null | "error">(null);
  const [checking, setChecking] = useState(false);

  const flip = () => {
    const current = request.options.find((option) => draft.includes(`\\"answer\\":\\"${option}\\"`));
    const next = request.options.find((option) => option !== current);
    if (current && next) setDraft(draft.replace(`\\"answer\\":\\"${current}\\"`, `\\"answer\\":\\"${next}\\"`));
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

  const changed = draft !== originalText;

  return (
    <section aria-labelledby="tamper-heading" className="border-t border-rule pt-8">
      <h2 id="tamper-heading" className="text-lg font-semibold">Try to change the answer</h2>
      <p className="mt-1 max-w-prose text-[14px] text-ink-2">
        Edit the model's response and check it against the same signature. Any change, even one character, breaks the
        signature, and the contract refuses it.
      </p>
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div>
          <label htmlFor="draft" className="sr-only">Response bytes</label>
          <textarea
            id="draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            rows={6}
            className="w-full resize-y rounded-md border border-rule-strong bg-surface p-3 font-mono text-[12px] leading-5"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={run} disabled={checking}>{checking ? "Checking…" : "Check this response"}</Button>
            <Button variant="outline" onClick={flip}>Flip the answer</Button>
            <Button variant="outline" onClick={() => { setDraft(originalText); setBrowser(null); setContract(null); }} disabled={!changed}>
              Reset
            </Button>
          </div>
        </div>
        <div aria-live="polite" className="space-y-3">
          {!browser && <p className="text-[13px] text-ink-2">Results appear here.</p>}
          {browser && (
            <Result
              who="Your browser"
              accepted={browser.accepted}
              detail={browser.accepted ? `Answer: ${browser.answer?.answer}` : browser.checks.find((c) => !c.passed)?.failure ?? ""}
            />
          )}
          {browser && !PREVIEW && contract === null && checking && <Skeleton className="h-16" />}
          {contract === "error" && <Result who="The contract" accepted={false} detail="Couldn't reach the contract to ask it." />}
          {contract && contract !== "error" && (
            <Result
              who={`The contract (check_response)`}
              accepted={contract.accepted}
              detail={contract.accepted ? `Answer: ${contract.answer}` : contract.error ?? ""}
            />
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
