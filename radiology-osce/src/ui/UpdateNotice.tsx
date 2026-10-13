import { useEffect, useState } from "react";

/**
 * When a new version of the app (or of the question bank) has been downloaded in the background,
 * offer a reload. Progress is stored separately, so reloading never loses anything.
 */
export function UpdateNotice() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;   // first install is not an "update"
    const onChange = () => { if (hadController) setReady(true); };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onChange);
  }, []);
  if (!ready) return null;
  return (
    <div className="toast update" role="status">
      <span>A new version is ready.</span>
      <button onClick={() => location.reload()}>Reload</button>
    </div>
  );
}
