import { Button, Hash, Label, Notice, Panel, Skeleton, Tag, formatTime } from "../components/ui";
import { useLoad } from "../lib/useLoad";
import { getPolicy, listModels, type ModelView, type PolicyView } from "../lib/verdict";

export function Models() {
  const [models, retry] = useLoad(listModels, "models");

  return (
    <div className="space-y-8">
      <section className="max-w-3xl">
        <h1 className="text-[26px] font-semibold tracking-tight">Models</h1>
        <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-ink-2">
          A model's signing key is accepted only after the contract has checked its Intel TDX quote with NEAR's{" "}
          <code className="font-mono text-[13px]">tee-verifier</code>, and then checked that the quote binds this key and a
          fresh nonce, runs without debug access, and comes from a deployment the policy allows.
        </p>
      </section>

      {models.state === "loading" && <Skeleton className="h-64" />}
      {models.state === "error" && (
        <Notice tone="fail" title="Couldn't read the models" action={<Button variant="outline" onClick={retry}>Try again</Button>}>
          {models.message}
        </Notice>
      )}
      {models.state === "ready" && models.data.length === 0 && (
        <Notice title="No model has a policy yet">
          The owner pins a model's allowed deployments with <code className="font-mono">verdict-registrar policy</code>, then
          anyone can register it with live evidence.
        </Notice>
      )}
      {models.state === "ready" &&
        models.data.map(([name, model]) => <ModelCard key={name} name={name} model={model} />)}
    </div>
  );
}

function ModelCard({ name, model }: { name: string; model: ModelView | null }) {
  const expired = model ? Number(model.expires_at_ms) < Date.now() : false;
  const [policy] = useLoad((signal) => getPolicy(name, signal), `policy-${name}`);

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-5 py-4">
        <h2 className="font-mono text-[15px] font-medium">{name}</h2>
        {!model && <Tag tone="plain">NOT REGISTERED</Tag>}
        {model && !expired && <Tag tone="pass">REGISTERED</Tag>}
        {model && expired && <Tag tone="wait">EXPIRED</Tag>}
      </div>

      {model ? (
        <dl className="grid gap-x-8 gap-y-4 px-5 py-5 sm:grid-cols-2">
          <Field label="Signing key"><Hash value={model.signing_address} /></Field>
          <Field label="Intel TCB status"><span className="font-mono text-[13px]">{model.tcb_status}</span></Field>
          <Field label="App configuration (compose hash)"><Hash value={model.compose_hash} /></Field>
          <Field label="VM image (MRTD)"><Hash value={model.image.mr_td} /></Field>
          <Field label="Registered">
            <span className="font-mono text-[13px]">{formatTime(model.registered_at_ms)} by {model.registered_by}</span>
          </Field>
          <Field label="Valid until">
            <span className="font-mono text-[13px]">{formatTime(model.expires_at_ms)}</span>
          </Field>
        </dl>
      ) : (
        <p className="px-5 py-5 text-[14px] text-ink-2">
          No key is registered. Call <code className="font-mono">start_registration</code>, fetch the attestation with that
          nonce, and submit it with <code className="font-mono">register_model</code>.
        </p>
      )}

      <div className="border-t border-rule px-5 py-4">
        <Label>Allowed deployments</Label>
        {policy.state === "loading" && <Skeleton className="mt-3 h-10" />}
        {policy.state === "error" && <p className="mt-2 text-[13px] text-fail">Couldn't read the policy: {policy.message}</p>}
        {policy.state === "ready" && <Deployments policy={policy.data} current={model} />}
      </div>
    </Panel>
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
            {active && <Tag tone="pass">REGISTERED FROM THIS</Tag>}
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
