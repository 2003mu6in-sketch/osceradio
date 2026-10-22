import { useAuth, accountsEnabled } from "../sync/supabase.ts";
import { useSync } from "../sync/sync.ts";
import type { ReactNode } from "react";
import { useRoute } from "../lib/router.ts";
import { IconBrowse, IconLog, IconReview, IconSettings, IconStudy } from "./icons.tsx";

const NAV = [
  { href: "#/", match: (p: string) => p === "/" || p.startsWith("/study"), label: "Study", Icon: IconStudy },
  { href: "#/browse", match: (p: string) => p.startsWith("/browse") || p.startsWith("/card"), label: "Browse", Icon: IconBrowse },
  { href: "#/review", match: (p: string) => p.startsWith("/review"), label: "Review", Icon: IconReview },
  { href: "#/log", match: (p: string) => p.startsWith("/log"), label: "Error log", Icon: IconLog },
  { href: "#/settings", match: (p: string) => p.startsWith("/settings") || p.startsWith("/about") || p.startsWith("/account"), label: "Settings", Icon: IconSettings },
];

export function Shell({ children, dueCount = 0, focus = false }: { children: ReactNode; dueCount?: number; focus?: boolean }) {
  const { path } = useRoute();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/"><img src="./icon.svg" alt="" width={28} height={28} />Masterpiece <small>OSCE &amp; MCQ</small></a>
          <nav className={focus ? "nav nav-focus" : "nav"} aria-label="Main">
            {NAV.map(({ href, match, label, Icon }) => (
              <a key={href} href={href} aria-current={match(path) ? "page" : undefined}>
                <Icon />{label}
                {label === "Review" && dueCount > 0 && <span className="badge" aria-label={`${dueCount} due`}>{dueCount}</span>}
              </a>
            ))}
          </nav>
          <AccountChip />
        </div>
      </header>
      <main id="main" className={focus ? "focus" : undefined}>{children}</main>
    </>
  );
}

/** Top-right: "Sign in", or the sync state when signed in. Hidden when accounts are not configured. */
function AccountChip() {
  const auth = useAuth();
  const sync = useSync();
  if (!accountsEnabled()) return null;
  const label = !auth.user ? "Sign in"
    : sync.status === "syncing" ? "Syncing…"
    : sync.status === "offline" ? "Offline"
    : sync.status === "error" || sync.status === "choose" ? "Sync paused"
    : "Synced";
  const tone = !auth.user ? "" : sync.status === "error" || sync.status === "choose" ? "bad" : sync.status === "idle" ? "good" : "wait";
  return (
    <a className={`acct ${tone}`} href="#/account" title={auth.user ? `Signed in as ${auth.user.email}` : "Sign in to sync your progress"}
      aria-label={auth.user ? `Account: ${auth.user.email}. ${label}` : "Sign in to sync your progress"}>
      {auth.user ? <span className="dot" aria-hidden="true" /> : null}{label}
    </a>
  );
}
