import type { Content, Kind, Modality, Section, Subject } from "../data/types.ts";
import { SUBJECTS, subjectName } from "../data/types.ts";
import { itemSections } from "../data/content.ts";
import { href } from "../lib/router.ts";
import { useProgress } from "../storage/progress.ts";
import { updateSettings, useSettings } from "../storage/settings.ts";
import { dueList, relTime, upcomingList } from "../logic/schedule.ts";
import { useNow } from "../lib/useNow.ts";

const RAD_NOTES: Record<string, string> = {
  "70W": "Image bank with model answers",
  "30R": "Annotated exam slides",
  "2025": "Exam photos",
  TIPS: "Dr. Akorli final tips · 2025 slides",
  "2023": "Exam images + recalled questions",
  "2021": "Same slides as 2017 Q9–24",
  "2018": "Same slides as 2019",
};

const BLURB: Record<Subject, string> = {
  radiology: "Image questions from twelve papers plus the radiology MCQ papers.",
  anaesthesia: "Equipment and drug slides, manned stations and the anaesthesia MCQ papers and question bank.",
  ophthalmology: "Picture OSCE questions, fundus models and the ophthalmology MCQ papers and question bank.",
  ent: "Picture and station questions plus the ENT MCQ papers.",
};

export function Home({ content }: { content: Content }) {
  const settings = useSettings();
  const subject = settings.subject;
  const { reviews, session, errors } = useProgress();
  const now = useNow();

  const items = [...content.items.values()].filter((it) => it.card.subject === subject);
  const count = (k: Kind) => items.filter((it) => it.kind === k).length;
  const seen = (k: Kind) => items.filter((it) => it.kind === k && reviews.get(it.card.id)?.seen).length;
  const ids = new Set(items.map((it) => it.card.id));
  const mine = [...reviews.values()].filter((r) => ids.has(r.cardId));
  const due = dueList(mine, now).length;
  const dueAll = dueList(reviews.values(), now).length;
  const next = upcomingList(mine, now)[0];
  const subjectErrors = errors.filter((e) => ids.has(e.cardId)).length;
  const notes = content.notes.filter((n) => n.subject === subject);
  const active = session && session.index < session.order.length ? session : null;

  const sectionsOf = (kind: "osce" | "mcq") => content.sections.filter((s) => s.subject === subject && (kind === "osce" ? s.kind === "osce" : s.kind !== "osce"));
  const perSection = (s: Section) => {
    const its = items.filter((it) => itemSections(it).includes(s.id));
    return { total: its.length, seen: its.filter((it) => reviews.get(it.card.id)?.seen).length };
  };

  const modalities = subject === "radiology"
    ? Object.entries(content.cards.filter((c) => c.subject === "radiology").reduce<Record<string, number>>((m, c) => ({ ...m, [c.modality]: (m[c.modality] ?? 0) + 1 }), {}))
      .sort((a, b) => b[1] - a[1]) as [Modality, number][]
    : [];

  return (
    <div className="section-gap">
      <div className="subject-tabs" role="tablist" aria-label="Subject">
        {SUBJECTS.map((s) => (
          <button key={s.id} role="tab" aria-selected={s.id === subject} className="subject-tab"
            onClick={() => updateSettings({ subject: s.id })}>{s.name}</button>
        ))}
      </div>

      <section className="hero">
        <div>
          <p className="eyebrow">Masterpiece · {subjectName(subject)}</p>
          <h1>{subjectName(subject)} OSCE &amp; MCQ practice</h1>
          <p className="lede">{BLURB[subject]} Wrong answers go to your error log and come back for review after 48 hours.</p>
        </div>
        <div className="hero-stats">
          <div><b>{count("osce")}</b><span>OSCE questions</span></div>
          <div><b>{count("mcq")}</b><span>MCQs</span></div>
          {count("photo") > 0 && <div><b>{count("photo")}</b><span>paper photos</span></div>}
        </div>
      </section>

      <section className="actions" aria-label="Start">
        {active && (
          <a className="action primary" href="#/study/run">
            <strong>Continue: {active.title}</strong>
            <span>Question {active.index + 1} of {active.order.length}</span>
          </a>
        )}
        <a className={due ? "action due" : "action"} href={href("/review", { subject })}>
          <strong>{due ? `Review due: ${due}` : "Nothing to review"}</strong>
          <span>{due
            ? `${subjectName(subject)} questions you got wrong are ready for another try.${dueAll > due ? ` ${dueAll - due} more due in other subjects.` : ""}`
            : next ? `Next ${subjectName(subject)} review ${relTime(next.dueAt, now)}. ${subjectErrors} in your error log.`
            : dueAll ? `${dueAll} due in other subjects.` : "Questions you mark wrong come back here after 48 hours, then 72 hours."}</span>
        </a>
      </section>

      <section className="actions kinds" aria-label="Question types">
        <a className={active ? "action" : "action primary"} href={href("/study", { subject, kind: "osce" })}>
          <strong>OSCE picture questions</strong>
          <span>{count("osce")} questions · {seen("osce")} seen. Look, answer, reveal, then mark yourself.</span>
        </a>
        <a className="action" href={href("/study", { subject, kind: "mcq" })}>
          <strong>MCQs</strong>
          <span>{count("mcq")} questions · {seen("mcq")} seen. Tap an option; the app marks it.</span>
        </a>
        {count("photo") > 0 && (
          <a className="action" href={href("/study", { subject, kind: "photo" })}>
            <strong>Paper photos</strong>
            <span>{count("photo")} photographed {count("photo") === 1 ? "question" : "questions"} that could not be typed out. Reveal the key, then mark yourself.</span>
          </a>
        )}
        {notes.length > 0 && (
          <a className="action" href={href(`/notes/${subject}`)}>
            <strong>Revision notes</strong>
            <span>{notes.map((n) => n.title.replace(`${subjectName(subject)} `, "")).join(" · ")}</span>
          </a>
        )}
      </section>

      {(["osce", "mcq"] as const).map((kind) => {
        const secs = sectionsOf(kind);
        if (!secs.length) return null;
        return (
          <section key={kind} className="stack" aria-labelledby={`papers-${kind}`}>
            <h2 id={`papers-${kind}`}>{kind === "osce" ? "OSCE by paper" : "MCQs by paper"}</h2>
            <div className="papers">
              {secs.map((s) => {
                const n = perSection(s);
                return (
                  <a key={s.id} className="paper" href={href("/study", { subject, kind: kind === "osce" ? "osce" : "", section: s.id })}>
                    <span>
                      <span className="name">{s.name}</span><br />
                      <span className="sub">{subject === "radiology" && kind === "osce" ? (RAD_NOTES[s.id] ?? "Past paper") : kind === "osce" ? "OSCE" : "MCQ paper"}</span>
                    </span>
                    <span className="meter" aria-label={`${n.seen} of ${n.total} seen`}><i style={{ width: `${(100 * n.seen) / (n.total || 1)}%` }} /></span>
                    <span className="count">{n.seen ? `${n.seen}/` : ""}{n.total}</span>
                  </a>
                );
              })}
            </div>
            {kind === "osce" && subject === "radiology" && <p className="muted" style={{ margin: 0, fontSize: ".875rem" }}>Repeated images are stored once, so the same question counts towards every paper it appeared in.</p>}
            {kind === "mcq" && <p className="muted" style={{ margin: 0, fontSize: ".875rem" }}>Questions repeated across years are stored once and listed under the newest paper.</p>}
          </section>
        );
      })}

      {modalities.length > 0 && (
        <section className="stack" aria-labelledby="mod-h">
          <h2 id="mod-h">Radiology OSCE by modality</h2>
          <div className="chips">
            {modalities.map(([m, n]) => (
              <a key={m} className="chip" href={href("/study", { subject, kind: "osce", modality: m })}>{m} <b>{n}</b></a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
