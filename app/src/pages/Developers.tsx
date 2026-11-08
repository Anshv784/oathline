import { CopyButton, Label } from "../components/ui";
import { CONTRACT } from "../lib/oathline";

const oathline = CONTRACT ?? "verdict.testnet";

const snippet = `#[ext_contract(ext_oathline)]
trait Oathline {
    fn ask(&mut self, model: String, instructions: String, submission: String,
           options: Vec<String>, notify: Option<bool>) -> Settled;
}

ext_oathline::ext("${oathline}".parse().unwrap())
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
    <div className="space-y-14">
      <section className="grid gap-8 md:grid-cols-12">
        <div className="md:col-span-7">
          <Label>For developers</Label>
          <h1 className="serif mt-3 text-[40px] leading-[1.05] tracking-tight md:text-[52px]">
            One cross-contract call. <span className="italic text-seal">An answer under oath.</span>
          </h1>
        </div>
        <p className="text-[15.5px] leading-relaxed text-ink-2 md:col-span-5 md:pt-10">
          Send a rule, the thing to judge and the allowed answers. Your callback receives an answer Oathline has already
          verified, or a clear failure. No oracle to run, no relayer, no API key on your side.
        </p>
      </section>

      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-10">
          <Code n="I" title="Ask, from your contract (Rust, near-sdk)" code={snippet} />
          <Code n="II" title="What your callback receives" code={result} />
          <Code n="III" title="Try it now from the CLI, through the demo DAO" code={cli} />
        </div>
        <aside className="space-y-8 lg:border-l lg:border-rule lg:pl-8">
          <div>
            <Label>Terms</Label>
            <dl className="mt-3 divide-y divide-rule">
              {facts.map(([term, text]) => (
                <div key={term} className="py-2.5">
                  <dt className="text-[14px] font-medium">{term}</dt>
                  <dd className="text-[14px] leading-relaxed text-ink-2">{text}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <Label>Already in use by</Label>
            <ul className="mt-3 space-y-2 text-[14px] leading-relaxed">
              <li><span className="font-mono text-[12.5px]">charter-dao</span> — screens grant proposals against a charter</li>
              <li><span className="font-mono text-[12.5px]">market</span> — resolves prediction markets, from posted or fetched evidence</li>
            </ul>
          </div>
          <p className="text-[14px] leading-relaxed text-ink-2">
            Contracts, runner, fetcher, registrar and this site are open source on{" "}
            <a className="text-seal underline underline-offset-4" href="https://github.com/Anshv784/oathline" target="_blank" rel="noreferrer">GitHub</a>, MIT.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Code({ n, title, code }: { n: string; title: string; code: string }) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 border-b border-ink pb-2">
        <h2 className="text-[15px] font-medium"><span className="serif mr-2 italic text-seal">{n}.</span>{title}</h2>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto bg-sheet px-5 py-4 font-mono text-[12.5px] leading-6">{code}</pre>
    </section>
  );
}
