import { ChevronRight } from "lucide-react";
import { Seal } from "../components/brand";
import { Button, Hash, Label, Notice, PassMark, Skeleton, Tag, formatTime, roman } from "../components/ui";
import { useLoad } from "../lib/useLoad";
import { getPolicy, listModels, type ModelView, type PolicyView } from "../lib/oathline";

export function Models() {
  const [models, retry] = useLoad(listModels, "models");

  return (
    <div className="space-y-12">
      <section className="max-w-3xl">
        <Label>The sworn model</Label>
        <h1 className="serif mt-3 text-[40px] leading-[1.05] tracking-tight md:text-[52px]">
          Before a model may testify, it <span className="italic text-seal">proves which machine it is</span>.
        </h1>
        <p className="mt-5 max-w-prose text-[16.5px] leading-relaxed text-ink-2">
          Oathline accepts answers only from a signing key whose Intel TDX quote was verified on chain, for a fresh nonce,
          from a NEAR AI build the owner allowed. The oath lapses after 14 days, so the model has to prove itself again.
        </p>
      </section>

      {models.state === "loading" && <Skeleton className="h-80" />}
      {models.state === "error" && (
        <Notice tone="fail" title="Couldn't read the models" action={<Button variant="outline" onClick={retry}>Try again</Button>}>
          {models.message}
        </Notice>
      )}
      {models.state === "ready" && models.data.length === 0 && (
        <Notice title="No model has been sworn in yet">The owner first chooses which NEAR AI builds to allow; then anyone can register the model with fresh proof.</Notice>
      )}
      {models.state === "ready" && models.data.map(([name, model]) => <Certificate key={name} name={name} model={model} />)}
    </div>
  );
}

function Certificate({ name, model }: { name: string; model: ModelView | null }) {
  const expired = model ? Number(model.expires_at_ms) < Date.now() : false;
  const trusted = Boolean(model && !expired);
  const [policy] = useLoad((signal) => getPolicy(name, signal), `policy-${name}`);
  const proofs = model
    ? [
        "Intel TDX quote verified on chain by tee-verifier",
        `Intel firmware status: ${model.tcb_status === "UpToDate" ? "up to date" : model.tcb_status}`,
        "Signing key bound to a one-time nonce from this contract",
        "Debug access off; boot log replays to RTMR3",
        "Running a NEAR AI build the owner allowed",
      ]
    : [];

  return (
    <article className="border border-rule bg-sheet px-5 py-8 md:px-12 md:py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink pb-3 font-mono text-[12px] text-ink-2">
        <span>CERTIFICATE OF ADMISSION</span>
        <span>{model ? `registered by ${model.registered_by}` : "not registered"}</span>
      </div>

      <div className="mt-8 grid gap-8 md:grid-cols-[1fr_auto]">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="serif text-[32px] tracking-tight">{name}</h2>
            {!model && <Tag tone="plain">NOT REGISTERED</Tag>}
            {trusted && <Tag tone="pass">SWORN</Tag>}
            {model && expired && <Tag tone="wait">OATH LAPSED</Tag>}
          </div>
          {model && (
            <p className="mt-2 text-[16px]">
              {trusted ? "Sworn until " : "Its oath lapsed on "}
              <span className="font-medium">{formatTime(model.expires_at_ms)}</span>
              {trusted ? ". Proven afresh " : ". It was last proven "}
              {formatTime(model.registered_at_ms)}.
            </p>
          )}
          {model && (
            <ol className="mt-6">
              {proofs.map((proof, i) => (
                <li key={proof} className="grid grid-cols-[2rem_1.5rem_1fr] items-start gap-2 border-b border-rule py-2.5 last:border-b-0">
                  <span className="serif text-[14px] italic text-ink-3">{roman(i + 1)}.</span>
                  <PassMark passed />
                  <span className="text-[15px]">{proof}</span>
                </li>
              ))}
            </ol>
          )}
          {model && (
            <p className="mt-5 flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
              The key that signs every answer <Hash value={model.signing_address} />
            </p>
          )}
        </div>
        {trusted && (
          <div className="flex justify-center md:pt-2">
            <Seal label="SWORN" sub="ADMITTED · TEE-VERIFIER · INTEL TDX" size={150} />
          </div>
        )}
      </div>

      <details className="group mt-8 border-t border-rule pt-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] text-ink-2 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="size-4 transition-transform group-open:rotate-90" />
          Measurements and allowed builds
        </summary>
        <div className="mt-4 space-y-5">
          {model && (
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              <Field label="App configuration (compose hash)"><Hash value={model.compose_hash} /></Field>
              <Field label="VM image (MRTD)"><Hash value={model.image.mr_td} /></Field>
              <Field label="Intel TCB status"><span className="font-mono text-[13px]">{model.tcb_status}</span></Field>
              <Field label="Valid until"><span className="font-mono text-[13px]">{formatTime(model.expires_at_ms)}</span></Field>
            </dl>
          )}
          <div>
            <Label>Allowed NEAR AI builds</Label>
            {policy.state === "loading" && <Skeleton className="mt-3 h-10" />}
            {policy.state === "error" && <p className="mt-2 text-[13px] text-fail">Couldn't read the policy: {policy.message}</p>}
            {policy.state === "ready" && <Builds policy={policy.data} current={model} />}
          </div>
        </div>
      </details>
    </article>
  );
}

function Builds({ policy, current }: { policy: PolicyView | null; current: ModelView | null }) {
  if (!policy) return <p className="mt-2 text-[13px] text-ink-2">No policy.</p>;
  return (
    <ul className="mt-3 space-y-2">
      {policy.deployments.map((d) => {
        const active = current?.compose_hash === d.compose_hash && current.image.mr_td === d.image.mr_td;
        return (
          <li key={`${d.image.mr_td}-${d.compose_hash}`} className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]">
            <span className="text-ink-3">image</span> <Hash value={d.image.mr_td} />
            <span className="text-ink-3">compose</span> <Hash value={d.compose_hash} />
            {active && <Tag tone="seal">SWORN FROM THIS BUILD</Tag>}
          </li>
        );
      })}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-[12px] text-ink-3">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
