import { useSyncExternalStore } from "react";

/** Minimal hash router: works on any static host (GitHub Pages, file shares) and offline. */
export interface Route { path: string; parts: string[]; query: URLSearchParams }

export function parse(hash: string): Route {
  const raw = hash.replace(/^#/, "") || "/";
  const [p, q = ""] = raw.split("?");
  const path = p.startsWith("/") ? p : `/${p}`;
  return { path, parts: path.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

let current = parse(typeof location === "undefined" ? "" : location.hash);
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    current = parse(location.hash);
    listeners.forEach((l) => l());
  });
}

export function useRoute(): Route {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => current);
}

export function href(path: string, query?: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v);
  const qs = q.toString();
  return `#${path}${qs ? `?${qs}` : ""}`;
}

export function navigate(path: string, query?: Record<string, string | undefined>, replace = false) {
  const h = href(path, query);
  if (replace) history.replaceState(null, "", h), window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = h.slice(1);
}
