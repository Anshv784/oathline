import { Label, roman } from "../components/ui";

type Step = { plain: string; text: string; tech: string };

const admission: Step[] = [
  {
    plain: "Oathline hands out a one-time nonce",
    text: "So the proof that follows has to be made now, for us, and can't be an old one replayed.",
    tech: "start_registration(model) → 32-byte nonce, valid 10 minutes",
  },
  {
    plain: "The model's enclave answers with an Intel TDX quote",
    text: "A report signed by the CPU itself: this exact VM image and app build are running, this is the signing key, and here is your nonce.",
    tech: "report_data = signing key ‖ 12 zero bytes ‖ nonce; MRTD, RTMR0–3, MRCONFIGID",
  },
  {
    plain: "NEAR checks Intel's signature, on chain",
    text: "tee-verifier, a NEAR contract with no access keys, verifies the quote's certificate chain back to Intel and that the firmware is patched.",
    tech: "tee-verifier.verify_quote (DCAP) · TCB UpToDate · ≈176 Tgas",
  },
  {
    plain: "Oathline checks the details, then pins the key",
    text: "The key is bound to our nonce, debug is off, the boot log replays, and the build is one the owner allowed. The key is then trusted for 14 days.",
    tech: "report_data binding · TD_ATTRIBUTES.debug = 0 · RTMR3 replay · compose-hash policy",
  },
];

const asking: Step[] = [
  {
    plain: "A contract asks",
    text: "It sends a rule, the thing to judge, and the allowed answers, such as APPROVE or REJECT.",
    tech: "ask(model, instructions, submission, options) — 0.15 NEAR, 170 Tgas",
  },
  {
    plain: "Oathline writes the question itself",
    text: "It builds the exact request bytes and stores their fingerprint, so nobody can reword the question later.",
    tech: "request body built on chain · sha256 stored · response schema forces an allowed answer",
  },
  {
    plain: "A sealed worker asks NEAR AI exactly once",
    text: "An OutLayer worker, itself in a TDX enclave and pinned by its WASM hash, sends those bytes once and brings back the answer and signature. It never retries.",
    tech: "OutLayer request_execution · runner pinned by sha256 · caller checked against the contract",
  },
  {
    plain: "Oathline checks the oath, then replies",
    text: "Signed by the pinned key, over this question and this answer, with an allowed answer. Only then does the asking contract receive it.",
    tech: "ecrecover(EIP-191, model:sha256(request):sha256(response)) == pinned key",
  },
  {
    plain: "The record stays on chain",
    text: "The raw answer and signature are stored, so anyone can examine the oath again later, as this site does in your browser.",
    tech: "get_request returns every byte · check_response re-judges any bytes you give it",
  },
];

const glossary = [
  ["Sealed machine (TEE)", "A computer whose memory the chip itself locks. Not even the server's owner can look in or change what runs. Here: Intel TDX."],
  ["Quote (attestation)", "A report signed by Intel's hardware saying exactly what software a sealed machine runs and which key it holds."],
  ["Oath (signature)", "A stamp only the model's key can make. Change one letter of the answer and the stamp no longer matches."],
  ["Fingerprint (hash)", "A short code computed from data. Any change to the data gives a completely different code."],
  ["OutLayer", "NEAR's service that runs small programs in sealed machines when a contract asks, then reports back to the contract."],
];

export function How() {
  return (
    <div className="space-y-20">
      <section className="max-w-3xl">
        <Label>How it works</Label>
        <h1 className="serif mt-3 text-[40px] leading-[1.05] tracking-tight md:text-[52px]">
          An oath has two parts: <span className="italic text-seal">who swears</span>, and <span className="italic text-seal">what was sworn</span>.
        </h1>
        <p className="mt-5 max-w-prose text-[16.5px] leading-relaxed text-ink-2">
          NEAR AI runs models in Intel TDX enclaves and signs every answer. Until now only scripts checked those signatures,
          off chain. Oathline moves both checks into a NEAR contract, so another contract can act on the answer without
          trusting anyone in between.
        </p>
      </section>

      <Part title="Who swears" when="Once, then every 14 days" steps={admission} />
      <Part title="What was sworn" when="Every question" steps={asking} />

      <section className="grid gap-10 md:grid-cols-2">
        <div>
          <h2 className="serif text-[26px]">What you still trust</h2>
          <ul className="mt-4 space-y-3 text-[15px] leading-relaxed">
            <li className="border-l-2 border-rule-strong pl-4">Intel's sealed machines, and the owner's choice of which NEAR AI builds to allow.</li>
            <li className="border-l-2 border-rule-strong pl-4">OutLayer to run the pinned worker once. It never retries, so it cannot keep asking until it likes the answer.</li>
            <li className="border-l-2 border-rule-strong pl-4">The model's judgment. Oathline proves which model answered and what it said, not that the answer is wise.</li>
            <li className="border-l-2 border-rule-strong pl-4">The GPU's own NVIDIA evidence is checked off chain by the registrar, not on chain: a NEAR contract has no cheap P-384 check today.</li>
          </ul>
        </div>
        <div>
          <h2 className="serif text-[26px]">Words used here</h2>
          <dl className="mt-4 space-y-4">
            {glossary.map(([term, text]) => (
              <div key={term}>
                <dt className="serif text-[17px]">{term}</dt>
                <dd className="text-[14.5px] leading-relaxed text-ink-2">{text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  );
}

function Part({ title, when, steps }: { title: string; when: string; steps: Step[] }) {
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-ink pb-2">
        <h2 className="serif text-[30px]">{title}</h2>
        <span className="font-mono text-[12.5px] text-ink-3">{when}</span>
      </div>
      <ol>
        {steps.map((step, i) => (
          <li key={step.plain} className="grid gap-x-8 gap-y-2 border-b border-rule py-5 md:grid-cols-[3rem_1fr_1fr]">
            <span className="serif text-[18px] italic text-seal">{roman(i + 1)}.</span>
            <div>
              <h3 className="text-[16.5px] font-medium">{step.plain}</h3>
              <p className="mt-1 text-[14.5px] leading-relaxed text-ink-2">{step.text}</p>
            </div>
            <p className="font-mono text-[12.5px] leading-relaxed text-ink-2 md:pt-0.5">{step.tech}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
