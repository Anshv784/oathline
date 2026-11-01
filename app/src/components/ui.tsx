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
      className="-m-2 inline-flex size-9 shrink-0 items-center justify-center rounded text-ink-2 hover:text-ink"
      aria-label={copied ? "Copied" : "Copy value"}
    >
      {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
    </button>
  );
}

export function PassMark({ passed }: { passed: boolean }) {
  return passed ? (
    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-pass-wash text-pass">
      <Check aria-hidden strokeWidth={2.5} className="size-3.5" />
      <span className="sr-only">Passed</span>
    </span>
  ) : (
    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-fail-wash text-fail">
      <X aria-hidden strokeWidth={2.5} className="size-3.5" />
      <span className="sr-only">Failed</span>
    </span>
  );
}

const TONE = {
  pass: "bg-pass-wash text-pass",
  fail: "bg-fail-wash text-fail",
  wait: "bg-wait-wash text-wait",
  plain: "bg-transparent text-ink-2 ring-1 ring-inset ring-rule-strong",
} as const;

export function Tag({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[12px] font-medium tracking-wide ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-2">{children}</div>;
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-md border border-rule bg-surface ${className}`}>{children}</section>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded bg-rule/60 motion-reduce:animate-none ${className}`} />;
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
    <div role={tone === "fail" ? "alert" : undefined} className="rounded-md border border-dashed border-rule-strong px-5 py-8 text-center">
      <p className={`font-medium ${tone === "fail" ? "text-fail" : "text-ink"}`}>{title}</p>
      {children && <p className="mx-auto mt-1 max-w-prose text-sm text-ink-2">{children}</p>}
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
  const style =
    variant === "solid"
      ? "bg-ink text-paper hover:bg-ink/85"
      : "border border-rule-strong text-ink hover:bg-rule/40";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${style}`}
    >
      {children}
    </button>
  );
}

export function formatTime(ms: string | null): string {
  if (!ms) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(Number(ms)));
}
