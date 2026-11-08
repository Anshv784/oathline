import { Check, Copy, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

/** A hash or key, in mono. Long values are shortened in the middle; the full
 * value is in the title and the copy button. */
export function Hash({ value, full = false, className = "" }: { value: string; full?: boolean; className?: string }) {
  const short = !full && value.length > 26 ? `${value.slice(0, 12)}…${value.slice(-10)}` : value;
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 align-middle ${className}`}>
      <code title={value} className={`font-mono text-[13px] text-ink ${full ? "break-all" : "truncate"}`}>
        {short}
      </code>
      <CopyButton value={value} />
    </span>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true))}
      className="-m-2 inline-flex size-9 shrink-0 items-center justify-center rounded text-ink-3 hover:text-ink"
      aria-label={copied ? "Copied" : "Copy value"}
    >
      {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
    </button>
  );
}

/** A margin mark: a tick for a check that held, a cross for one that didn't. */
export function PassMark({ passed }: { passed: boolean }) {
  return passed ? (
    <span className="inline-flex size-5 shrink-0 items-center justify-center text-pass">
      <Check aria-hidden strokeWidth={2.5} className="size-4" />
      <span className="sr-only">Passed</span>
    </span>
  ) : (
    <span className="inline-flex size-5 shrink-0 items-center justify-center text-fail">
      <X aria-hidden strokeWidth={2.5} className="size-4" />
      <span className="sr-only">Failed</span>
    </span>
  );
}

const TONE = {
  pass: "text-pass border-pass/40 bg-pass-wash",
  fail: "text-fail border-fail/40 bg-fail-wash",
  wait: "text-wait border-wait/40 bg-wait-wash",
  seal: "text-seal border-seal/40 bg-seal-wash",
  plain: "text-ink-2 border-rule-strong bg-transparent",
} as const;

/** A ruling stamp: mono small caps in a hairline box. */
export function Tag({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center border px-1.5 py-px font-mono text-[11.5px] font-medium tracking-[0.12em] ${TONE[tone]}`}>
      {children}
    </span>
  );
}

/** A section label in the margin style of a register. */
export function Label({ children }: { children: ReactNode }) {
  return <div className="smallcaps font-mono text-[12.5px] text-ink-3">{children}</div>;
}

/** A sheet of the record: flat, ruled, no shadow. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`border border-rule bg-sheet ${className}`}>{children}</section>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse bg-rule/60 motion-reduce:animate-none ${className}`} />;
}

export function Notice({
  title,
  children,
  action,
  tone = "plain",
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  tone?: "plain" | "fail";
}) {
  return (
    <div role={tone === "fail" ? "alert" : undefined} className="border-l-2 border-rule-strong py-3 pl-5">
      <p className={`serif text-[19px] ${tone === "fail" ? "text-fail" : "text-ink"}`}>{title}</p>
      {children && <p className="mt-1 max-w-prose text-sm text-ink-2">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "solid",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "solid" | "outline";
  disabled?: boolean;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={buttonClass(variant)}>
      {children}
    </button>
  );
}

/** Button styling, for links that look like buttons. */
export function buttonClass(variant: "solid" | "outline" = "solid"): string {
  const style =
    variant === "solid"
      ? "bg-seal text-sheet hover:bg-seal/90"
      : "border border-ink/70 text-ink hover:bg-ink hover:text-sheet";
  return `inline-flex h-10 items-center justify-center gap-2 rounded-[3px] px-4 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${style}`;
}

export function formatTime(ms: string | null): string {
  if (!ms) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(Number(ms)));
}

export function formatDate(ms: string | null): string {
  if (!ms) return "—";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(Number(ms)));
}

/** Roman numerals for the register's margin. */
export function roman(n: number): string {
  const map: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}
