import Link from "next/link";
import { Suspense } from "react";
import { FEATURED_HREF } from "@/lib/featured";
import { Logo } from "./brand";
import { ChainSwitch, ChainSwitchFallback } from "./chain-switch";
import { HeaderSearch, MobileSearch } from "./search";

/** Landing header: numbered nav + Launch app. */
export function SiteHeader() {
  return (
    <header className="mx-auto w-full max-w-[1440px] px-6 md:px-12">
      <div className="flex items-center justify-between py-6">
        <Logo className="text-2xl md:text-[28px]" />
        <nav className="flex items-center gap-4 font-mono text-sm md:gap-9">
          <Link href={FEATURED_HREF} className="hidden hover:text-signal sm:block">
            01 Map
          </Link>
          <Link href="/explore" className="hidden hover:text-signal sm:block">
            02 Explore
          </Link>
          <Link href="/method" className="hidden hover:text-signal sm:block">
            03 Method
          </Link>
          <Link href="/explore" className="bg-ink px-5 py-3 text-white hover:bg-signal">
            Launch app
          </Link>
        </nav>
      </div>
      <div className="rule-6" />
    </header>
  );
}

/** App header: network switcher, search with ⌘K, Explore, Method. */
export function AppHeader({ active }: { active?: "explore" | "method" }) {
  return (
    <header className="border-b-2 border-ink bg-white">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-6 px-5 py-4 md:gap-8 md:px-12 md:py-5">
        <div className="flex shrink-0 items-center gap-4 md:gap-6">
          <Logo className="shrink-0 text-[22px] md:text-[26px]" />
          <Suspense fallback={<ChainSwitchFallback />}>
            <ChainSwitch />
          </Suspense>
        </div>
        <div className="hidden min-w-0 flex-1 md:flex">
          <HeaderSearch />
        </div>
        <nav className="hidden shrink-0 items-center gap-7 font-mono text-sm md:flex">
          <Link href="/explore" className={active === "explore" ? "border-b-[3px] border-ink pb-0.5" : "hover:text-signal"}>
            Explore
          </Link>
          <Link href="/method" className={active === "method" ? "border-b-[3px] border-ink pb-0.5" : "hover:text-signal"}>
            Method
          </Link>
        </nav>
        <div className="ml-auto shrink-0 md:hidden">
          <MobileSearch />
        </div>
      </div>
    </header>
  );
}
