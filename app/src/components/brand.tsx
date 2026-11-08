// Oathline's mark, wordmark and wax seal. The mark is one continuous stroke
// (see brand/make_mark.py): a closed seal ring, a stem, a raised oath hand.

const MARK = "M 32 59 A 27 27 0 1 1 32 5 A 27 27 0 1 1 32 59 L 32.00 42.27 L 33.05 42.27 C 38.30 42.27 41.94 38.77 41.94 33.17 L 41.94 22.60 A 2.10 2.10 0 0 0 37.74 22.60 L 37.74 30.02 L 37.74 19.24 A 2.24 2.24 0 0 0 33.26 19.24 L 33.26 29.32 L 33.26 17.98 A 2.24 2.24 0 0 0 28.78 17.98 L 28.78 29.32 L 28.78 20.57 A 2.24 2.24 0 0 0 24.30 20.57 L 24.30 31.56 L 22.83 29.39 A 2.03 2.03 0 0 0 19.47 31.70 L 23.25 37.44 C 25.07 40.38 27.45 42.27 30.95 42.27 L 32.00 42.27";

export function Mark({ size = 28, draw = false, className = "" }: { size?: number; draw?: boolean; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={size < 24 ? 3.4 : size > 120 ? 1.9 : 2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`${draw ? "ink-draw" : ""} ${className}`}
    >
      <path d={MARK} />
    </svg>
  );
}

export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-seal">
      <Mark size={size + 6} />
      <span className="serif font-semibold tracking-[-0.01em] text-ink" style={{ fontSize: size }}>
        Oathline
      </span>
    </span>
  );
}

/**
 * A wax seal pressed onto a record. `tone` says what the seal certifies:
 * upheld (the answer is proven), refused (the contract rejected it), pending.
 */
export function Seal({ label, sub, tone = "seal", size = 132 }: { label: string; sub?: string; tone?: "seal" | "fail" | "wait"; size?: number }) {
  const color = tone === "fail" ? "var(--fail)" : tone === "wait" ? "var(--wait)" : "var(--seal)";
  const id = `arc-${label.replace(/\W/g, "")}-${tone}`;
  return (
    <div className="seal-press shrink-0" style={{ width: size, height: size, transform: "rotate(-8deg)", color }}>
      <svg viewBox="0 0 120 120" width={size} height={size} aria-label={`${label}${sub ? ": " + sub : ""}`} role="img">
        <defs>
          <path id={id} d="M 60 60 m -42 0 a 42 42 0 1 1 84 0 a 42 42 0 1 1 -84 0" />
        </defs>
        {/* Wax: a slightly irregular disc. */}
        <path
          d="M60 4c9 0 13 5 21 7s14 1 19 8 2 13 6 21 10 12 10 20-6 12-10 20-1 14-6 21-11 6-19 8-12 7-21 7-13-5-21-7-14-1-19-8-2-13-6-21-10-12-10-20 6-12 10-20 1-14 6-21 11-6 19-8 12-7 21-7z"
          fill="currentColor"
          opacity="0.1"
        />
        <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <circle cx="60" cy="60" r="34" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <text fontFamily="IBM Plex Mono, monospace" fontSize="9" letterSpacing="2.6" fill="currentColor">
          <textPath href={`#${id}`} startOffset="2%">
            {(sub ?? "SWORN ON NEAR · INTEL TDX").toUpperCase()} ·
          </textPath>
        </text>
        <g transform="translate(38 33) scale(0.69)">
          <path d={MARK} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <text x="60" y="104" textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize="8.5" fontWeight="600" letterSpacing="1.5" fill="currentColor" opacity="0">
          {label}
        </text>
      </svg>
    </div>
  );
}
