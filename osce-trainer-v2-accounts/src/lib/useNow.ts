import { useEffect, useState } from "react";

/** Current time, refreshed every `ms` and when the app comes back to the foreground (so due counts stay live). */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, ms);
    const vis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", vis); window.removeEventListener("focus", tick); };
  }, [ms]);
  return now;
}
