import { useEffect, useState } from "react";
import { filterCards, itemPlace, kindLabel } from "../data/content.ts";
import type { Content, Modality, SectionId, Subject } from "../data/types.ts";
import { subjectName } from "../data/types.ts";
import { href, useRoute } from "../lib/router.ts";
import { Answer, Film, Question } from "../ui/CardParts.tsx";
import { McqFeedback, McqOptions, McqStem, Pictures, PhotoAnswer } from "../ui/McqParts.tsx";

/** Reference view of one question (Browse, error log, session summary). */
export function CardPage({ content, id }: { content: Content; id: string }) {
  const { query } = useRoute();
  const [shown, setShown] = useState(false);
  useEffect(() => { setShown(false); window.scrollTo(0, 0); }, [id]);
  const item = content.items.get(id);
  const q = { subject: query.get("subject") ?? "", section: query.get("section") ?? "", modality: query.get("modality") ?? "", q: query.get("q") ?? "", kind: query.get("kind") ?? "" };
  const list = item?.kind === "osce"
    ? filterCards(content.cards, { subject: q.subject as Subject | "", section: q.section as SectionId | "", modality: q.modality as Modality | "", query: q.q }).map((c) => c.id)
    : item ? content.mcqs.filter((c) => c.subject === item.card.subject && (!q.section || c.section === q.section)).map((c) => c.id) : [];
  const pos = list.indexOf(id);
  const prev = pos > 0 ? list[pos - 1] : null;
  const next = pos >= 0 && pos < list.length - 1 ? list[pos + 1] : null;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === " ") { e.preventDefault(); setShown((s) => !s); }
      if (e.key === "ArrowRight" && next) location.hash = href(`/card/${next}`, q).slice(1);
      if (e.key === "ArrowLeft" && prev) location.hash = href(`/card/${prev}`, q).slice(1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!item) return <div className="empty"><h2>Question not found</h2><p className="muted">“{id}” is not in this question bank.</p><a className="btn" href="#/browse">Back to Browse</a></div>;
  const back = href("/browse", { ...q, subject: q.subject || item.card.subject, kind: item.kind === "osce" ? "" : "mcq" });
  const nav = (
    <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
      {prev ? <a className="btn ghost" href={href(`/card/${prev}`, q)}>‹ Previous</a> : <span />}
      {next ? <a className="btn ghost" href={href(`/card/${next}`, q)}>Next ›</a> : <span />}
    </div>
  );
  const crumbs = (
    <div className="crumbs">
      <a href={back}>‹ Browse</a>
      <span className="muted">·</span>
      <span className="mono">{item.kind === "osce" ? item.card.id : itemPlace(item)}</span>
      <span className="chip small">{subjectName(item.card.subject)} · {kindLabel(item.kind)}</span>
      {item.kind === "osce" && item.card.subject === "radiology" && <span className="chip small accent">{item.card.modality}</span>}
      {pos >= 0 && <span className="muted" style={{ marginLeft: "auto" }}>{pos + 1} / {list.length}</span>}
    </div>
  );

  if (item.kind === "mcq") {
    const c = item.card;
    const reveal = c.type === "mcq" ? c.correct[0] ?? c.options[0]?.key ?? null : null;
    return (
      <div className="stack" style={{ gap: 16, maxWidth: 760 }}>
        {crumbs}
        <div className="panel">
          <McqStem card={c} content={content} />
          {c.type === "mcq" ? (
            <>
              <McqOptions card={c} chosen={shown ? reveal : null} onChoose={() => setShown(true)} reference />
              {shown && reveal && <McqFeedback card={c} chosen={reveal} reference />}
            </>
          ) : shown ? <div><p className="label">Answer</p>{(c.answerText ?? []).map((l, i) => <p key={i} style={{ margin: "0 0 4px" }}>{l}</p>)}</div> : null}
          {!shown && <button className="btn primary" onClick={() => setShown(true)}>Show answer</button>}
          {nav}
        </div>
      </div>
    );
  }
  if (item.kind === "photo") {
    return (
      <div className="stack" style={{ gap: 16, maxWidth: 760 }}>
        {crumbs}
        <div className="panel">
          <Pictures ids={item.card.images} content={content} alt="Photo of the question" />
          {shown ? <PhotoAnswer card={item.card} /> : <button className="btn primary" onClick={() => setShown(true)}>Show the key</button>}
        </div>
      </div>
    );
  }
  const card = item.card;
  return (
    <div className="stack" style={{ gap: 16 }}>
      {crumbs}
      <div className="card-view">
        <Film card={card} content={content} />
        <div className="panel">
          <Question card={card} />
          {shown ? <Answer card={card} /> : <button className="btn primary" onClick={() => setShown(true)}>Show answer</button>}
          {nav}
        </div>
      </div>
    </div>
  );
}
