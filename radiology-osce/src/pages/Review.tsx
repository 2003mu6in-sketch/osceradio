import type { Card, Content } from "../data/types.ts";
import { thumbUrl } from "../data/content.ts";
import { newId } from "../logic/progress.ts";
import { DELAY, HOUR, dueList, relTime, stageLabel, upcomingList, type DueItem } from "../logic/schedule.ts";
import { navigate } from "../lib/router.ts";
import { useNow } from "../lib/useNow.ts";
import { saveSession, useProgress } from "../storage/progress.ts";

/** Review lists never show the diagnosis or modality – that would give the answer away. */
export function ReviewPage({ content }: { content: Content }) {
  const now = useNow(30_000);
  const { reviews, ready } = useProgress();
  if (!ready) return <p className="loading">Loading your progress…</p>;
  const all = [...reviews.values()];
  const due = dueList(all, now);
  const upcoming = upcomingList(all, now);
  const mastered = all.filter((r) => r.stage === "mastered").length;
  const byId = new Map(content.cards.map((c) => [c.id, c]));

  const start = async () => {
    const t = Date.now();
    await saveSession({
      id: newId(), title: `Review · ${due.length} due`, filter: { review: true },
      order: due.map((d) => d.cardId), index: 0, results: {}, startedAt: t, updatedAt: t,
    });
    navigate("/study/run");
  };

  return (
    <div className="section-gap" style={{ maxWidth: 860 }}>
      <div>
        <h1>Review</h1>
        <p className="lede">A question you mark wrong comes back after {DELAY[1] / HOUR} hours. Get it right then and it returns once more after {DELAY[2] / HOUR} hours; right again and it is mastered. A wrong answer at any point starts the cycle again.</p>
      </div>

      <div className="hero-stats" aria-label="Review summary">
        <div><b style={{ color: due.length ? "var(--wrong)" : undefined }}>{due.length}</b><span>due now</span></div>
        <div><b>{upcoming.length}</b><span>coming up</span></div>
        <div><b style={{ color: "var(--right)" }}>{mastered}</b><span>mastered</span></div>
      </div>

      {due.length > 0 ? (
        <section className="panel">
          <h2>Due now</h2>
          <ReviewList items={due} byId={byId} now={now} sections={content.sections} />
          <button className="btn primary wide" onClick={start}>Start review ({due.length})</button>
        </section>
      ) : (
        <div className="empty">
          <h2>Nothing due</h2>
          <p className="muted">{upcoming.length
            ? `Your next review is ${relTime(upcoming[0].dueAt, now)}.`
            : "Questions you mark Wrong while studying will appear here when they are due."}</p>
          {!upcoming.length && <a className="btn" href="#/">Start studying</a>}
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="stack">
          <h2>Coming up</h2>
          <ReviewList items={upcoming} byId={byId} now={now} sections={content.sections} />
        </section>
      )}
    </div>
  );
}

function ReviewList({ items, byId, now, sections }: { items: DueItem[]; byId: Map<string, Card>; now: number; sections: Content["sections"] }) {
  const secName = (c?: Card) => sections.find((s) => s.id === c?.section)?.name ?? "";
  return (
    <ul className="review-list">
      {items.map((d) => {
        const c = byId.get(d.cardId);
        return (
          <li key={d.cardId}>
            <div className="rrow">
              <span className="rthumb">{c?.images[0] ? <img src={thumbUrl(c.images[0])} alt="" loading="lazy" /> : null}</span>
              <span className="rtext">
                <strong className="mono">{d.cardId}</strong>
                <span className="muted">{secName(c)}{c?.qNumber != null ? ` · question ${c.qNumber}` : ""}</span>
              </span>
              <span className="rmeta">
                <span className={`chip small ${d.stage === 2 ? "accent" : "warn"}`}>{stageLabel(d.stage)}</span>
                <span className={d.dueAt <= now ? "due" : "muted"}>{relTime(d.dueAt, now)}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
