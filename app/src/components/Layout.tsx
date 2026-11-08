import { NavLink, Outlet, useLocation } from "react-router-dom";
import { CONTRACT, PREVIEW } from "../lib/oathline";
import { EXPLORER, NETWORK } from "../lib/near";
import { Mark, Wordmark } from "./brand";

const nav = [
  { to: "/", label: "Record", end: true },
  { to: "/markets", label: "Markets", end: false },
  { to: "/how", label: "How it works", end: false },
  { to: "/models", label: "Sworn model", end: false },
  { to: "/developers", label: "Developers", end: false },
];

export function Layout() {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-10 focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">
        Skip to content
      </a>
      <header>
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-x-10 gap-y-3 px-4 pb-4 pt-6 md:px-8">
          <NavLink to="/" aria-label="Oathline, home">
            <Wordmark size={27} />
          </NavLink>
          <nav aria-label="Main" className="-mb-px flex gap-6 overflow-x-auto text-[14.5px]">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => {
                  const active = isActive || (item.to === "/" && pathname.startsWith("/v/"));
                  return `shrink-0 border-b-2 pb-1.5 ${active ? "border-seal text-ink" : "border-transparent text-ink-2 hover:text-ink"}`;
                }}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="mx-auto max-w-6xl px-4 md:px-8">
          <div className="border-t-2 border-ink" />
          <div className="mt-[3px] border-t border-ink" />
        </div>
      </header>

      {PREVIEW && (
        <div className="mx-auto mt-4 w-full max-w-6xl px-4 md:px-8">
          <p className="border-l-2 border-wait bg-wait-wash px-4 py-2 text-[13px] text-wait">
            No contract configured: this is a sample record signed by a fixed test key. Set{" "}
            <code className="font-mono">VITE_OATHLINE_CONTRACT</code> to read a live deployment.
          </p>
        </div>
      )}

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 md:px-8 md:py-14">
        <Outlet />
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 md:px-8">
        <div className="border-t border-ink" />
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 py-6 text-[13px] text-ink-2">
          <span className="inline-flex items-center gap-2 text-seal">
            <Mark size={18} />
            <span className="text-ink-2">Oathline is open source (MIT).</span>
          </span>
          {!PREVIEW && (
            <a className="font-mono text-[12px] hover:text-ink" href={`${EXPLORER[NETWORK]}/address/${CONTRACT}`} target="_blank" rel="noreferrer">
              {CONTRACT} · {NETWORK}
            </a>
          )}
          <a className="hover:text-ink" href="https://github.com/Anshv784/oathline" target="_blank" rel="noreferrer">GitHub</a>
          <a className="hover:text-ink" href="https://docs.near.ai/cloud/verification" target="_blank" rel="noreferrer">NEAR AI verification</a>
          <a className="hover:text-ink" href="https://github.com/near/mpc/tree/main/crates/tee-verifier" target="_blank" rel="noreferrer">tee-verifier</a>
          <a className="hover:text-ink" href="https://app.outlayer.ai" target="_blank" rel="noreferrer">OutLayer</a>
        </div>
      </footer>
    </div>
  );
}
