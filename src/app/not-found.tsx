import Link from "next/link";
import { AppHeader } from "@/components/headers";

export default function NotFound() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-[560px] flex-1 px-5 py-16">
        <div className="font-mono text-xs">404</div>
        <div className="relative mt-8">
          <div className="display text-[200px] leading-[0.8]" aria-hidden>
            404
          </div>
          <svg viewBox="0 0 460 200" className="absolute inset-0 h-full w-full" aria-hidden fill="none">
            <path d="M24 150 C 120 120, 220 130, 300 110 S 410 40, 440 18" stroke="#d10600" strokeWidth="4" pathLength={1} className="draw" />
            <circle cx="24" cy="150" r="10" fill="#d10600" />
          </svg>
        </div>
        <h1 className="display mt-10 text-[52px]">This string leads nowhere.</h1>
        <p className="mt-6 text-xl leading-snug">The page moved or never existed. The map is still where you left it.</p>
        <div className="mt-12 space-y-3">
          <Link href="/" className="flex h-14 items-center justify-center bg-signal font-extrabold text-white hover:bg-ink">
            Back to Redstring
          </Link>
          <Link href="/explore" className="flex h-14 items-center justify-center border-2 border-ink font-extrabold hover:bg-ink hover:text-white">
            Explore tokens
          </Link>
        </div>
      </main>
    </>
  );
}
