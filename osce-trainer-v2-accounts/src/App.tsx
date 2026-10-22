import { useContent } from "./data/useContent.ts";
import { useRoute } from "./lib/router.ts";
import { AboutPage } from "./pages/About.tsx";
import { Browse } from "./pages/Browse.tsx";
import { CardPage } from "./pages/CardPage.tsx";
import { Home } from "./pages/Home.tsx";
import { LogPage } from "./pages/ErrorLog.tsx";
import { ReviewPage } from "./pages/Review.tsx";
import { dueList } from "./logic/schedule.ts";
import { useNow } from "./lib/useNow.ts";
import { useProgress } from "./storage/progress.ts";
import { StudyPage } from "./pages/Study.tsx";
import { SettingsPage } from "./pages/Settings.tsx";
import { NotesPage } from "./pages/Notes.tsx";
import { AccountPage } from "./pages/Account.tsx";
import { startSync } from "./sync/sync.ts";
import { useEffect } from "react";
import { Shell } from "./ui/Shell.tsx";
import { BackupBanner } from "./ui/BackupBanner.tsx";
import { UpdateNotice } from "./ui/UpdateNotice.tsx";

export function App() {
  const { content, error } = useContent();
  const { parts } = useRoute();
  const now = useNow();
  const { reviews } = useProgress();
  const dueCount = dueList(reviews.values(), now).length;
  useEffect(() => { if (content) startSync((id) => content.items.has(id)); }, [content]);

  let page;
  if (error) page = <div className="empty"><h2>The question bank did not load</h2><p className="muted">{error} Check your connection and reload; after the first visit the app also works offline.</p><button className="btn" onClick={() => location.reload()}>Reload</button></div>;
  else if (!content) page = <p className="loading">Loading questions…</p>;
  else switch (parts[0] ?? "") {
    case "": page = <Home content={content} />; break;
    case "study": page = <StudyPage content={content} />; break;
    case "browse": page = <Browse content={content} />; break;
    case "card": page = <CardPage content={content} id={parts[1] ?? ""} />; break;
    case "review": page = <ReviewPage content={content} />; break;
    case "log": page = <LogPage content={content} />; break;
    case "notes": page = <NotesPage content={content} subject={parts[1] ?? ""} />; break;
    case "settings": page = <SettingsPage content={content} />; break;
    case "account": page = <AccountPage />; break;
    case "about": page = <AboutPage source={content.source} />; break;
    default: page = <div className="empty"><h2>Page not found</h2><a className="btn" href="#/">Go to Study</a></div>;
  }
  const focus = parts[0] === "study" && parts[1] === "run";
  return <Shell dueCount={dueCount} focus={focus}>{!focus && content && <BackupBanner />}{page}{!focus && <UpdateNotice />}</Shell>;
}
