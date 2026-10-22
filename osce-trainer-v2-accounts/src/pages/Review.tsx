import type { Content, Item, Subject } from "../data/types.ts";
import { SUBJECTS, subjectName } from "../data/types.ts";
import { itemPlace, kindLabel, thumbUrl } from "../data/content.ts";
import { newId } from "../logic/progress.ts";
import { DELAY, HOUR, dueList, relTime, stageLabel, upcomingList, type DueItem } from "../logic/schedule.ts";
import { href, navigate, useRoute } from "../lib/router.ts";
import { useNow } from "../lib/useNow.ts";
import { saveSession, useProgress } from "../storage/progress.ts";

/** Review lists never show an OSCE diagnosis or modality – that would give the answer away. */
export function ReviewPage({ content }: { content: Content }) {
  const now = useNow(30_000);
  const { query } = useRoute();
  const { reviews, ready } = useProgress();
  if (!ready) return <p className="loading">Loading your progress…</p>;
  const sq = query.get("subject") ?? "";
  const subject = (SUBJECTS.some((s) => s.id === sq) ? sq : "") as Subject | "";
  const inSubject = (id: string) => { const it = content.items.get(id); return !!it && (!subject || it.card.subject === subject); };
  const all = [...reviews.values()].filter((r) => inSubject(r.cardId));
  const due = dueList(all, now);
  const upcoming = upcomingList(all, now);
  const mastered = all.filter((r) => r.stage === "mastered").length;
  const dueBySubject = SUBJECTS.map((s) => ({ s, n: dueList([...reviews.values()].filter((r) => content.items.get(r.cardId)?.card.subject === s.id), now).length }));

  const start = async () => {
    const t = Date.now();
    await saveSession({
      id: newId(), title: `Review${subject ? ` · ${subjectName(subject)}` : ""} · ${due.length} due`, filter: { review: true, subject: subject || undefined },
      order: due.map((d) => d.cardId), index: 0, results: {}, startedAt: t, updatedAt: t,
    });
    navigate("/study/run");
  };

  return (
    <div className="section-gap" style={{ maxWidth: 860 }}>
      <div>
        <h1>Review{subject ? ` · ${subjectName(subject)}` : ""}</h1>
        <p className="lede">A question you get wrong comes back after {DELAY[1] / HOUR} hours. Get it right then and it returns once more after {DELAY[2] / HOUR} hours; right again and it is mastered. A wrong answer at any point starts the cycle again.</p>
      </div>

      <div className="chips" role="group" aria-label="Subject">
        <a className={subject ? "chip" : "chip on"} href="#/review" aria-current={!subject ? "page" : undefined}>All subjects <b>{dueBySubject.reduce((a, x) => a + x.n, 0)}</b></a>
        {dueBySubject.map(({ s, n }) => (
          <a key={s.id} className={subject === s.id ? "chip on" : "chip"} href={href("/review", { subject: s.id })} aria-current={subject === s.id ? "page" : undefined}>{s.name} <b>{n}</b></a>
        ))}
      </div>

      <div className="hero-stats" aria-label="Review summary">
        <div><b style={{ color: due.length ? "var(--wrong)" : undefined }}>{due.length}</b><span>due now</span></div>
        <div><b>{upcoming.length}</b><span>coming up</span></div>
        <div><b style={{ color: "var(--right)" }}>{mastered}</b><span>mastered</span></div>
      </div>

      {due.length > 0 ? (
        <section className="panel">
          <h2>Due now</h2>
          <ReviewList items={due} content={content} now={now} />
          <button className="btn primary wide" onClick={start}>Start review ({due.length})</button>
        </section>
      ) : (
        <div className="empty">
          <h2>Nothing due</h2>
          <p className="muted">{upcoming.length
            ? `Your next review is ${relTime(upcoming[0].dueAt, now)}.`
            : "Questions you get wrong while studying will appear here when they are due."}</p>
          {!upcoming.length && <a className="btn" href="#/">Start studying</a>}
        </div>
      )}

      {upcoming.length > 0 && (
        <section className="stack">
          <h2>Coming up</h2>
          <ReviewList items={upcoming} content={content} now={now} />
        </section>
      )}
    </div>
  );
}

function thumbOf(it?: Item): string | undefined {
  return it?.card.images[0];
}

function ReviewList({ items, content, now }: { items: DueItem[]; content: Content; now: number }) {
  return (
    <ul className="review-list">
      {items.map((d) => {
        const it = content.items.get(d.cardId);
        const img = thumbOf(it);
        return (
          <li key={d.cardId}>
            <div className="rrow">
              <span className="rthumb">{img ? <img src={thumbUrl(img)} alt="" loading="lazy" /> : null}</span>
              <span className="rtext">
                <strong className="mono">{it?.kind === "osce" ? d.cardId : it ? itemPlace(it) : d.cardId}</strong>
                <span className="muted">{it ? `${subjectName(it.card.subject)} · ${kindLabel(it.kind)}${it.kind === "osce" ? ` · ${content.sections.find((s) => s.id === it.card.section)?.name ?? ""}${it.card.qNumber != null ? ` · question ${it.card.qNumber}` : ""}` : ""}` : ""}</span>
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
