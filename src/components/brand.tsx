import Link from "next/link";

export function Logo({ className = "", invert = false }: { className?: string; invert?: boolean }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 font-extrabold tracking-[-0.03em] ${invert ? "text-white" : "text-ink"} ${className}`} aria-label="Redstring home">
      <CrowMark className="h-[1.45em] w-auto -translate-y-[0.06em]" />
      <span>Redstring</span>
    </Link>
  );
}

/** Logo mark: a crow perched on a branch against a red sun. Crow takes the text colour. */
export function CrowMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="8 8 84 88" className={className} aria-hidden>
      <circle cx="50" cy="45" r="34" fill="#d10600" />
      <path fill="currentColor" d="M50 18 C53 13 60 13 63 16.5 C70 17 77 19.5 83 24 C77 25.5 70 27 65 28.5 C67 31 69 34 68.5 37 C71 44 71.5 55 67 64 C64 70 60 74 55 76 L49.5 94 L37 94 L42.5 80 C39 70 39 54 42 42 C43.5 34 46 26 50 18 Z" />
      <path d="M46 44 C52 48 58 54 59 62 C59 70 53 76 47 84" stroke="#fff" strokeWidth="0.9" fill="none" opacity="0.35" />
      <path d="M55 75 L54 86 M61 72 L63 86" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M10 87.5 L90 85.5 M74 86 L83 80.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <circle cx="59.5" cy="20.5" r="1.8" fill="#d10600" />
    </svg>
  );
}

/** The signature element: one red line between two black dots. */
export function StringMark({ className = "", curve = false }: { className?: string; curve?: boolean }) {
  if (curve)
    return (
      <svg viewBox="0 0 420 360" className={className} aria-hidden fill="none">
        <path d="M30 330 C 170 290, 210 210, 260 140 S 360 30, 395 18" stroke="#d10600" strokeWidth="3.5" pathLength={1} className="draw" />
        <circle cx="30" cy="330" r="12" fill="#0a0a0a" />
        <circle cx="395" cy="18" r="12" fill="#0a0a0a" />
      </svg>
    );
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden fill="none">
      <line x1="10" y1="54" x2="54" y2="10" stroke="#d10600" strokeWidth="5" />
      <circle cx="10" cy="54" r="8" fill="#0a0a0a" />
      <circle cx="54" cy="10" r="8" fill="#0a0a0a" />
    </svg>
  );
}

/** Flat geometric crow: black silhouette, one red eye, optional red string in its beak. */
export function Crow({ className = "", string: withString = true, dropped = false }: { className?: string; string?: boolean; dropped?: boolean }) {
  return (
    <svg viewBox="0 0 180 120" className={className} aria-hidden fill="none">
      {/* body + tail */}
      <path d="M18 96 L52 74 L86 46 L118 30 L140 26 L150 34 L134 40 L126 62 L106 84 L76 90 L52 92 L40 104 Z" fill="#0a0a0a" />
      {/* head + beak */}
      <path d="M112 26 L130 14 L146 16 L176 26 L146 30 L136 40 Z" fill="#0a0a0a" />
      {/* wing line */}
      <path d="M62 60 L94 62 L106 80" stroke="#fff" strokeWidth="3" />
      {/* legs */}
      <path d="M76 90 L72 112 M88 88 L94 112" stroke="#0a0a0a" strokeWidth="4" />
      {/* eye */}
      <circle cx="140" cy="20" r="4" fill="#d10600" />
      {withString && !dropped && <path d="M170 28 C 182 50, 172 80, 156 104 C 150 114, 160 118, 166 114" stroke="#d10600" strokeWidth="3" className="pull" />}
      {dropped && <path d="M138 116 C 146 104, 160 104, 168 112" stroke="#d10600" strokeWidth="3" />}
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-4 px-6 py-6 font-mono text-xs md:px-12">
      <p>Links show on-chain activity, not proof of one owner.</p>
      <nav className="flex gap-6">
        <Link href="/method" className="underline underline-offset-4">
          Docs
        </Link>
        <a href="https://x.com/RedstringRH"className="underline underline-offset-4" rel="noreferrer" target="_blank">
          X
        </a>
        <Link href="/method#terms" className="underline underline-offset-4">
          Terms
        </Link>
      </nav>
    </footer>
  );
}
