import { ChevronRight } from "lucide-react";
import { Button, Hash, Label, Notice, Panel, PassMark, Skeleton, Tag, formatTime } from "../components/ui";
import { useLoad } from "../lib/useLoad";
import { getPolicy, listModels, type ModelView, type PolicyView } from "../lib/verdict";

export function Models() {
  const [models, retry] = useLoad(listModels, "models");

  return (
    <div className="space-y-8">
      <section className="max-w-3xl">
        <h1 className="text-[28px] font-semibold tracking-tight md:text-[34px]">The AI that Verdict trusts</h1>
        <p className="mt-3 max-w-prose text-[16px] leading-relaxed text-ink-2">
          Verdict only accepts answers from an AI that has proved, with an Intel certificate checked on chain, that it runs in a
          genuine sealed machine. The proof expires after 7 days, so the AI has to prove itself again every week.
        </p>
      </section>

      {models.state === "loading" && <Skeleton className="h-64" />}
      {models.state === "error" && (
        <Notice tone="fail" title="Couldn't read the models" action={<Button variant="outline" onClick={retry}>Try again</Button>}>
          {models.message}
        </Notice>
      )}
      {models.state === "ready" && models.data.length === 0 && (
        <Notice title="No model has been set up yet">
          The owner first chooses which NEAR AI builds to allow, then anyone can register the model with fresh proof.
        </Notice>
      )}
      {models.state === "ready" && models.data.map(([name, model]) => <ModelCard key={name} name={name} model={model} />)}
    </div>
  );
}

function ModelCard({ name, model }: { name: string; model: ModelView | null }) {
  const expired = model ? Number(model.expires_at_ms) < Date.now() : false;
  const [policy] = useLoad((signal) => getPolicy(name, signal), `policy-${name}`);
  const trusted = Boolean(model && !expired);

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-4">
        <h2 className="font-mono text-[16px] font-medium">{name}</h2>
        {!model && <Tag tone="plain">NOT REGISTERED</Tag>}
        {trusted && <Tag tone="pass">TRUSTED</Tag>}
        {model && expired && <Tag tone="wait">PROOF EXPIRED</Tag>}
      </div>

      <div className="px-5 py-5">
        {model ? (
          <>
            <p className="text-[15px] leading-relaxed">
              {trusted ? (
                <>Trusted until <span className="font-medium">{formatTime(model.expires_at_ms)}</span>.</>
              ) : (
                <>
                  Its proof ran out on <span className="font-medium">{formatTime(model.expires_at_ms)}</span>. New questions wait until it
                  proves itself again.
                </>
              )}
            </p>
            <ul className="mt-4 space-y-2.5">
              <Proof text="Intel certificate checked on chain by NEAR's tee-verifier contract" />
              <Proof text={`Intel firmware status: ${model.tcb_status === "UpToDate" ? "up to date" : model.tcb_status}`} />
              <Proof text="Running an approved NEAR AI build, with no debug access" />
              <Proof text={`Proved fresh on ${formatTime(model.registered_at_ms)}, using a one-time code from the contract`} />
            </ul>
            <p className="mt-4 flex flex-wrap items-center gap-x-2 text-[14px] text-ink-2">
              The AI's signing key <Hash value={model.signing_address} />
            </p>
          </>
        ) : (
          <p className="text-[14px] text-ink-2">No key is registered yet, so Verdict can't accept answers from this model.</p>
        )}
      </div>

      <details className="group border-t border-rule">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm hover:bg-paper [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="size-4 text-ink-2 transition-transform group-open:rotate-90" />
          Technical details
        </summary>
        <div className="space-y-5 px-5 pb-5">
          {model && (
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <Field label="Signing key"><Hash value={model.signing_address} /></Field>
              <Field label="Intel TCB status"><span className="font-mono text-[13px]">{model.tcb_status}</span></Field>
              <Field label="App configuration (compose hash)"><Hash value={model.compose_hash} /></Field>
              <Field label="VM image (MRTD)"><Hash value={model.image.mr_td} /></Field>
              <Field label="Registered by"><span className="font-mono text-[13px]">{model.registered_by}</span></Field>
              <Field label="Valid until"><span className="font-mono text-[13px]">{formatTime(model.expires_at_ms)}</span></Field>
            </dl>
          )}
          <div>
            <Label>Allowed NEAR AI builds</Label>
            {policy.state === "loading" && <Skeleton className="mt-3 h-10" />}
            {policy.state === "error" && <p className="mt-2 text-[13px] text-fail">Couldn't read the policy: {policy.message}</p>}
            {policy.state === "ready" && <Deployments policy={policy.data} current={model} />}
          </div>
        </div>
      </details>
    </Panel>
  );
}

function Proof({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3 text-[14px] leading-5">
      <PassMark passed />
      <span>{text}</span>
    </li>
  );
}

function Deployments({ policy, current }: { policy: PolicyView | null; current: ModelView | null }) {
  if (!policy) return <p className="mt-2 text-[13px] text-ink-2">No policy.</p>;
  return (
    <ul className="mt-3 space-y-2">
      {policy.deployments.map((deployment) => {
        const active = current?.compose_hash === deployment.compose_hash && current.image.mr_td === deployment.image.mr_td;
        return (
          <li key={`${deployment.image.mr_td}-${deployment.compose_hash}`} className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
            <span className="text-ink-2">image</span> <Hash value={deployment.image.mr_td} />
            <span className="text-ink-2">compose</span> <Hash value={deployment.compose_hash} />
            {active && <Tag tone="pass">IN USE</Tag>}
          </li>
        );
      })}
    </ul>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-[12px] text-ink-2">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
