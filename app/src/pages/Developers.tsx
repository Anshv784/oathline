import { CopyButton, Label, Panel } from "../components/ui";
import { CONTRACT } from "../lib/verdict";

const verdict = CONTRACT ?? "verdict.testnet";

const snippet = `#[ext_contract(ext_verdict)]
trait Verdict {
    fn ask(&mut self, model: String, instructions: String, submission: String,
           options: Vec<String>, notify: Option<bool>) -> Settled;
}

ext_verdict::ext("${verdict}".parse().unwrap())
    .with_attached_deposit(NearToken::from_millinear(150))
    .with_static_gas(Gas::from_tgas(170))
    .ask(
        "Qwen/Qwen3.8-27B".into(),
        charter,                         // your rule
        proposal,                        // what to judge
        vec!["APPROVE".into(), "REJECT".into()],
        None,
    )
    .then(Self::ext(env::current_account_id()).on_screened(proposal_id));`;

const result = `// on_screened receives:
Settled {
    request_id,
    outcome: answered { answer: "APPROVE", reason: "..." }
           | failed   { reason: "..." },
}`;

const cli = `near contract call-function as-transaction charter-dao.anshv784.testnet submit_proposal \\
  json-args '{"title":"My tool","description":"An open-source ..."}' \\
  prepaid-gas '300.0 Tgas' attached-deposit '0.15 NEAR' \\
  sign-as <you>.testnet network-config testnet sign-with-keychain send`;

const facts = [
  ["Deposit", "0.15 NEAR per question. It pays for storage and compute; what isn't used is refunded."],
  ["Compute used", "About 0.0016 NEAR per answer on OutLayer."],
  ["Gas", "Attach 170 Tgas to ask from a contract, or 300 Tgas for the whole call from a wallet."],
  ["Time", "About 25 seconds from the call to the answer, in one transaction."],
  ["Options", "2 to 8 answers, using A–Z, 0–9 and _."],
  ["Limits", "Rule and submission up to 4096 bytes each."],
];

export function Developers() {
  return (
    <div className="space-y-10">
      <section className="max-w-3xl">
        <h1 className="text-[28px] font-semibold tracking-tight md:text-[34px]">Use Verdict from your contract</h1>
        <p className="mt-3 max-w-prose text-[16px] leading-relaxed text-ink-2">
          One cross-contract call. You send a rule, the thing to judge and the allowed answers. Your callback receives an answer
          that Verdict has already verified, or a clear failure. No oracle, relayer or API key on your side.
        </p>
      </section>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Code title="Ask (Rust, near-sdk)" code={snippet} />
          <Code title="What your callback gets" code={result} />
          <Code title="Try it now from the CLI, through the demo DAO" code={cli} />
        </div>
        <div className="space-y-6">
          <Panel className="p-5">
            <Label>Good to know</Label>
            <dl className="mt-3 space-y-3">
              {facts.map(([term, text]) => (
                <div key={term}>
                  <dt className="text-[14px] font-medium">{term}</dt>
                  <dd className="text-[14px] leading-relaxed text-ink-2">{text}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel className="p-5">
            <Label>Use it for</Label>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed">
              <li>Screening DAO proposals against a charter</li>
              <li>Resolving prediction markets from a written rule</li>
              <li>Checking grant or bounty submissions</li>
              <li>Content rules for on-chain posts</li>
            </ul>
          </Panel>
          <Panel className="p-5 text-[14px] leading-relaxed">
            <Label>Source</Label>
            <p className="mt-2">
              Contracts, runner, registrar and this site are open source on{" "}
              <a className="underline underline-offset-4" href="https://github.com/Anshv784/verdict" target="_blank" rel="noreferrer">
                GitHub
              </a>
              . MIT licensed.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Code({ title, code }: { title: string; code: string }) {
  return (
    <Panel>
      <div className="flex items-center justify-between border-b border-rule py-2 pl-5 pr-3">
        <h2 className="text-[14px] font-medium">{title}</h2>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto px-5 py-4 font-mono text-[12.5px] leading-6">{code}</pre>
    </Panel>
  );
}
