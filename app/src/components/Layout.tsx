import { NavLink, Outlet, useLocation } from "react-router-dom";
import { CONTRACT, PREVIEW } from "../lib/verdict";
import { EXPLORER, NETWORK } from "../lib/near";

const nav = [
  { to: "/", label: "Live verdicts", end: true },
  { to: "/markets", label: "Market example", end: false },
  { to: "/how", label: "How it works", end: false },
  { to: "/models", label: "Trusted model", end: false },
  { to: "/developers", label: "For developers", end: false },
];

export function Layout() {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-10 focus:rounded focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">
        Skip to content
      </a>
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 md:px-6">
          <NavLink to="/" className="flex items-baseline gap-2 py-1">
            <span className="text-[17px] font-semibold tracking-tight">Verdict</span>
            <span className="hidden text-[13px] text-ink-2 xl:inline">AI answers smart contracts can check</span>
          </NavLink>
          <nav aria-label="Main" className="order-3 -mx-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => {
                  // A single verdict belongs to the verdicts section.
                  const active = isActive || (item.to === "/" && pathname.startsWith("/v/"));
                  return `shrink-0 rounded px-3 py-2 text-sm ${active ? "bg-rule/50 font-medium text-ink" : "text-ink-2 hover:text-ink"}`;
                }}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto font-mono text-[12px] text-ink-2">
            {PREVIEW ? (
              <span>offline sample</span>
            ) : (
              <a className="underline decoration-rule-strong underline-offset-4 hover:text-ink" href={`${EXPLORER[NETWORK]}/address/${CONTRACT}`} target="_blank" rel="noreferrer">
                {CONTRACT} · {NETWORK}
              </a>
            )}
          </div>
        </div>
      </header>

      {PREVIEW && (
        <div className="border-b border-rule bg-wait-wash">
          <p className="mx-auto max-w-6xl px-4 py-2 text-[13px] text-wait md:px-6">
            No contract configured. This is a sample answer signed by a fixed test key, so you can see the checks work. Set{" "}
            <code className="font-mono">VITE_VERDICT_CONTRACT</code> to read a live deployment.
          </p>
        </div>
      )}

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-6 md:py-12">
        <Outlet />
      </main>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-1 px-4 py-5 text-[13px] text-ink-2 md:px-6">
          <span>Built on NEAR AI, Intel TDX, tee-verifier and OutLayer. Testnet.</span>
          <a className="hover:text-ink" href="https://github.com/Anshv784/verdict" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
          <a className="hover:text-ink" href="https://docs.near.ai/cloud/verification" target="_blank" rel="noreferrer">
            NEAR AI verification
          </a>
          <a className="hover:text-ink" href="https://app.outlayer.ai" target="_blank" rel="noreferrer">
            OutLayer
          </a>
        </div>
      </footer>
    </div>
  );
}
