import type { ReactNode } from "react";
import { useRoute } from "../lib/router.ts";
import { IconBrowse, IconLog, IconReview, IconSettings, IconStudy } from "./icons.tsx";

const NAV = [
  { href: "#/", match: (p: string) => p === "/" || p.startsWith("/study"), label: "Study", Icon: IconStudy },
  { href: "#/browse", match: (p: string) => p.startsWith("/browse") || p.startsWith("/card"), label: "Browse", Icon: IconBrowse },
  { href: "#/review", match: (p: string) => p.startsWith("/review"), label: "Review", Icon: IconReview },
  { href: "#/log", match: (p: string) => p.startsWith("/log"), label: "Error log", Icon: IconLog },
  { href: "#/settings", match: (p: string) => p.startsWith("/settings") || p.startsWith("/about"), label: "Settings", Icon: IconSettings },
];

export function Shell({ children, dueCount = 0, focus = false }: { children: ReactNode; dueCount?: number; focus?: boolean }) {
  const { path } = useRoute();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#/"><img src="./icon.svg" alt="" width={28} height={28} />Radiology OSCE <small>Trainer</small></a>
          <nav className={focus ? "nav nav-focus" : "nav"} aria-label="Main">
            {NAV.map(({ href, match, label, Icon }) => (
              <a key={href} href={href} aria-current={match(path) ? "page" : undefined}>
                <Icon />{label}
                {label === "Review" && dueCount > 0 && <span className="badge" aria-label={`${dueCount} due`}>{dueCount}</span>}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main id="main" className={focus ? "focus" : undefined}>{children}</main>
    </>
  );
}
