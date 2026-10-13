import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { requestPersistence } from "./storage/db.ts";
import { loadSettings } from "./storage/settings.ts";
import { loadProgress } from "./storage/progress.ts";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

loadSettings();
loadProgress();
requestPersistence().catch(() => {});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .then((reg) => {
        // look for a new version when the app is reopened and every 6 hours while it stays open
        const check = () => reg.update().catch(() => {});
        document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
        setInterval(check, 6 * 3_600_000);
      })
      .catch((e) => console.warn("Offline mode unavailable:", e));
  });
}
