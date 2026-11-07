import { Label, Panel } from "../components/ui";

type Step = { plain: string; text: string; tech: string };

const admission: Step[] = [
  {
    plain: "Verdict hands out a one-time code",
    text: "So the proof that follows must be made fresh, right now, and can't be an old one replayed.",
    tech: "start_registration(model) → single-use nonce, valid 10 minutes",
  },
  {
    plain: "The AI's sealed machine makes an Intel certificate",
    text: "It says: I am a genuine Intel sealed machine, running this exact NEAR AI software, and this is my signing key. It includes the one-time code.",
    tech: "NEAR AI attestation: Intel TDX quote, report_data = signing key ‖ nonce",
  },
  {
    plain: "NEAR checks Intel's signature on chain",
    text: "A NEAR contract that nobody can change verifies the certificate really comes from Intel and the firmware is up to date.",
    tech: "tee-verifier.verify_quote (DCAP), TCB status UpToDate",
  },
  {
    plain: "Verdict checks the details and remembers the key",
    text: "No debug access, the approved NEAR AI build, our one-time code. Then the AI's key is trusted for 7 days.",
    tech: "debug bit, MRCONFIGID, RTMR3 replay, compose hash, image policy",
  },
];

const asking: Step[] = [
  {
    plain: "A contract asks a question",
    text: "It gives a rule, something to judge, and the allowed answers, like APPROVE or REJECT.",
    tech: "ask(model, instructions, submission, options)",
  },
  {
    plain: "Verdict writes the exact question",
    text: "Verdict builds the request itself and stores its fingerprint, so nobody can reword it later.",
    tech: "request body built on chain, sha256 stored",
  },
  {
    plain: "A sealed worker asks the AI exactly once",
    text: "An OutLayer worker, itself running in a sealed machine, sends the question to NEAR AI one time and brings back the answer and its signature. It never retries.",
    tech: "OutLayer TDX worker, runner pinned by WASM hash",
  },
  {
    plain: "Verdict checks the signature, then replies",
    text: "Signed by the trusted key, for this question and this answer, with an allowed answer. Only then does the asking contract get it.",
    tech: "on_inference: ECDSA over model:sha256(request):sha256(response)",
  },
  {
    plain: "The proof stays on chain",
    text: "The raw answer and signature are kept, so anyone can check them again later, like this website does.",
    tech: "get_request returns every byte",
  },
];

const glossary = [
  ["Sealed machine (TEE)", "A computer whose memory is locked by the chip itself. Not even the server owner can see inside or change what runs. Here: Intel TDX."],
  ["Intel certificate (attestation)", "A report signed by Intel that says what software a sealed machine runs and which key it holds."],
  ["Signature", "A stamp only the AI's key can make. If one letter of the answer changes, the stamp no longer matches."],
  ["Fingerprint (hash)", "A short code computed from data. Any change to the data gives a completely different code."],
  ["NEAR AI", "NEAR's AI service. It runs models in sealed machines and signs every answer."],
  ["OutLayer", "NEAR's service that runs small programs in sealed machines when a contract asks, then reports back."],
  ["Testnet", "NEAR's practice network. Same software, tokens with no value."],
];

export function How() {
  return (
    <div className="space-y-12">
      <section className="max-w-3xl">
        <h1 className="text-[28px] font-semibold tracking-tight md:text-[34px]">How it works</h1>
        <p className="mt-3 max-w-prose text-[16px] leading-relaxed text-ink-2">
          NEAR AI runs models inside sealed machines and signs every answer. Until now, only websites and scripts checked those
          signatures. Verdict does the checking inside a NEAR smart contract, so other contracts can safely act on an AI's answer.
          NEAR's own example of an AI-run DAO still lists this check as "TODO".
        </p>
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Steps title="Part 1: Proving which AI it is" when="Once a week" steps={admission} />
        <Steps title="Part 2: Asking a question" when="Every time" steps={asking} />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel className="p-5">
          <Label>What you still have to trust</Label>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] leading-relaxed">
            <li>Intel's sealed machines, and the owner's choice of which NEAR AI builds to allow.</li>
            <li>OutLayer to run the worker once. The worker never retries, so it can't keep asking until it likes the answer.</li>
            <li>The AI's judgment. Verdict proves which AI answered and what it said, not that the answer is wise.</li>
            <li>The GPU's own certificate (NVIDIA) is not checked on chain yet. It is too costly for a NEAR contract today.</li>
          </ul>
        </Panel>
        <Panel className="p-5">
          <Label>Words used on this site</Label>
          <dl className="mt-3 space-y-3">
            {glossary.map(([term, text]) => (
              <div key={term}>
                <dt className="text-[14px] font-medium">{term}</dt>
                <dd className="text-[14px] leading-relaxed text-ink-2">{text}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}

function Steps({ title, when, steps }: { title: string; when: string; steps: Step[] }) {
  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-3 border-b border-rule px-5 py-4">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-[13px] text-ink-2">{when}</span>
      </div>
      <ol className="divide-y divide-rule">
        {steps.map((step, index) => (
          <li key={step.plain} className="flex gap-4 px-5 py-4">
            <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[12px] text-paper">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="font-medium leading-snug">{step.plain}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{step.text}</p>
              <p className="mt-1.5 font-mono text-[12px] text-ink-2/80">{step.tech}</p>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
