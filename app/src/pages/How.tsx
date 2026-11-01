import { Label, Panel } from "../components/ui";

const admission = [
  ["start_registration(model)", "The contract issues a single-use nonce, valid for ten minutes."],
  ["NEAR AI attestation", "Anyone fetches the model's attestation with that nonce. Its Intel TDX quote commits to the model's signing key and the nonce."],
  ["tee-verifier.verify_quote", "NEAR's locked DCAP verifier checks the quote's Intel signature chain and TCB status on chain."],
  ["Binding rules", "The contract checks report_data = key ‖ nonce, the debug bit, MRCONFIGID against the app configuration, and replays the RTMR3 event log."],
  ["Policy", "The VM image and app configuration must be one of the deployments the owner pinned. Then the key is stored for seven days."],
];

const asking = [
  ["ask(model, instructions, submission, options)", "The contract writes the request body itself, tags it with a unique id, and stores its SHA-256."],
  ["OutLayer worker (TDX)", "A runner pinned by its WASM hash sends exactly those bytes to NEAR AI once, and fetches the model's signature."],
  ["on_inference", "The contract accepts the answer only if the registered key signed sha256(request) and sha256(response), and the answer is an allowed option."],
  ["Stored proof", "The raw response and signature are kept, so anyone can check the verdict again from chain state, as this site does."],
];

export function How() {
  return (
    <div className="space-y-10">
      <section className="max-w-3xl">
        <h1 className="text-[26px] font-semibold tracking-tight">How it works</h1>
        <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-ink-2">
          NEAR AI runs models in Intel TDX enclaves and signs every response. Until now, only off-chain code could check those
          signatures. Verdict does the whole check inside a NEAR contract, so another contract can act on the answer.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Steps title="Admitting a model" steps={admission} />
        <Steps title="Asking a question" steps={asking} />
      </div>

      <Panel className="max-w-3xl p-5">
        <Label>What you still trust</Label>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] leading-relaxed">
          <li>Intel TDX, and the owner's choice of which NEAR AI deployments to allow.</li>
          <li>OutLayer to run the pinned runner once. The runner never retries the completion, so an operator cannot keep asking until it likes the answer.</li>
          <li>The model's judgment. The contract proves which model answered and what it said, not that the answer is right.</li>
          <li>NVIDIA GPU evidence is not yet checked on chain; NEAR contracts have no cheap P-384 verification.</li>
        </ul>
      </Panel>
    </div>
  );
}

function Steps({ title, steps }: { title: string; steps: string[][] }) {
  return (
    <Panel>
      <h2 className="border-b border-rule px-5 py-4 font-semibold">{title}</h2>
      <ol className="divide-y divide-rule">
        {steps.map(([name, text], index) => (
          <li key={name} className="flex gap-4 px-5 py-4">
            <span className="font-mono text-[13px] text-ink-2">{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0">
              <code className="font-mono text-[13px] font-medium">{name}</code>
              <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
