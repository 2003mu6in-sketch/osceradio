import { countBy } from "../data/content.ts";
import type { Content, Modality, SectionId } from "../data/types.ts";
import { href } from "../lib/router.ts";
import { useProgress } from "../storage/progress.ts";
import { dueList, relTime, upcomingList } from "../logic/schedule.ts";
import { useNow } from "../lib/useNow.ts";

const SECTION_NOTES: Partial<Record<SectionId, string>> = {
  "70W": "Image bank with model answers",
  "30R": "Annotated exam slides",
  "2025": "Exam photos",
  TIPS: "Dr. Akorli final tips · 2025 slides",
  "2023": "Exam images + recalled questions",
  "2021": "Same slides as 2017 Q9–24",
  "2018": "Same slides as 2019",
};

export function Home({ content }: { content: Content }) {
  const bySection = countBy(content.cards, (c) => c.inSections);
  const byModality = countBy(content.cards, (c) => [c.modality]);
  const modalities = (Object.entries(byModality) as [Modality, number][]).sort((a, b) => b[1] - a[1]);
  const images = content.cards.filter((c) => !c.textOnly).length;
  const { reviews, session, errors } = useProgress();
  const seenBySection = countBy(content.cards.filter((c) => reviews.get(c.id)?.seen), (c) => c.inSections);
  const seenTotal = content.cards.filter((c) => reviews.get(c.id)?.seen).length;
  const active = session && session.index < session.order.length ? session : null;
  const now = useNow();
  const due = dueList(reviews.values(), now).length;
  const next = upcomingList(reviews.values(), now)[0];

  return (
    <div className="section-gap">
      <section className="hero">
        <div>
          <p className="eyebrow">Masterpiece OSCE Radiology</p>
          <h1>Radiology OSCE practice</h1>
          <p className="lede">Image questions from twelve papers and question banks. Mark each one right or wrong; wrong answers go to your error log and come back for review after 48 hours.</p>
        </div>
        <div className="hero-stats">
          <div><b>{content.cards.length}</b><span>questions</span></div>
          <div><b>{images}</b><span>with images</span></div>
          <div><b>{content.sections.length}</b><span>papers</span></div>
        </div>
      </section>

      <section className="actions" aria-label="Start">
        {active ? (
          <a className="action primary" href="#/study/run">
            <strong>Continue: {active.title}</strong>
            <span>Question {active.index + 1} of {active.order.length}</span>
          </a>
        ) : (
          <a className="action primary" href={href("/study")}>
            <strong>Study all questions</strong>
            <span>{seenTotal ? `${seenTotal} of ${content.cards.length} seen` : `${content.cards.length} questions, in paper order`}</span>
          </a>
        )}
        <a className={due ? "action due" : "action"} href="#/review">
          <strong>{due ? `Review due: ${due}` : "Nothing to review"}</strong>
          <span>{due
            ? "Questions you got wrong are ready for another try."
            : next ? `Next review ${relTime(next.dueAt, now)}. ${errors.length} in your error log.`
            : "Questions you mark wrong come back here after 48 hours, then 72 hours."}</span>
        </a>
      </section>

      <section className="stack" aria-labelledby="papers-h">
        <h2 id="papers-h">Study by paper</h2>
        <div className="papers">
          {content.sections.map((s) => (
            <a key={s.id} className="paper" href={href("/study", { section: s.id })}>
              <span>
                <span className="name">{s.name}</span><br />
                <span className="sub">{SECTION_NOTES[s.id] ?? "Past paper"}</span>
              </span>
              <span className="meter" aria-label={`${seenBySection[s.id] ?? 0} of ${bySection[s.id] ?? 0} seen`}><i style={{ width: `${(100 * (seenBySection[s.id] ?? 0)) / (bySection[s.id] || 1)}%` }} /></span>
              <span className="count">{seenBySection[s.id] ? `${seenBySection[s.id]}/` : ""}{bySection[s.id] ?? 0}</span>
            </a>
          ))}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: ".875rem" }}>Repeated images are stored once, so the same question counts towards every paper it appeared in.</p>
      </section>

      <section className="stack" aria-labelledby="mod-h">
        <h2 id="mod-h">Study by modality</h2>
        <div className="chips">
          {modalities.map(([m, n]) => (
            <a key={m} className="chip" href={href("/study", { modality: m })}>{m} <b>{n}</b></a>
          ))}
        </div>
      </section>
    </div>
  );
}
