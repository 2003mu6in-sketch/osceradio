import { useEffect, useState } from "react";
import { filterCards } from "../data/content.ts";
import type { Content, Modality, SectionId } from "../data/types.ts";
import { href, useRoute } from "../lib/router.ts";
import { Answer, Film, Question } from "../ui/CardParts.tsx";

/** Reference view of one question (Browse). Study mode in phase 3 adds Right / Wrong. */
export function CardPage({ content, id }: { content: Content; id: string }) {
  const { query } = useRoute();
  const [shown, setShown] = useState(false);
  useEffect(() => { setShown(false); window.scrollTo(0, 0); }, [id]);
  const card = content.cards.find((c) => c.id === id);
  const q = { section: query.get("section") ?? "", modality: query.get("modality") ?? "", q: query.get("q") ?? "" };
  const list = filterCards(content.cards, { section: q.section as SectionId | "", modality: q.modality as Modality | "", query: q.q });
  const pos = list.findIndex((c) => c.id === id);
  const prev = pos > 0 ? list[pos - 1] : null;
  const next = pos >= 0 && pos < list.length - 1 ? list[pos + 1] : null;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === " ") { e.preventDefault(); setShown((s) => !s); }
      if (e.key === "ArrowRight" && next) location.hash = href(`/card/${next.id}`, q).slice(1);
      if (e.key === "ArrowLeft" && prev) location.hash = href(`/card/${prev.id}`, q).slice(1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!card) return <div className="empty"><h2>Question not found</h2><p className="muted">“{id}” is not in this question bank.</p><a className="btn" href="#/browse">Back to Browse</a></div>;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="crumbs">
        <a href={href("/browse", q)}>‹ Browse</a>
        <span className="muted">·</span>
        <span className="mono">{card.id}</span>
        <span className="chip small accent">{card.modality}</span>
        {pos >= 0 && <span className="muted" style={{ marginLeft: "auto" }}>{pos + 1} / {list.length}</span>}
      </div>
      <div className="card-view">
        <Film card={card} content={content} />
        <div className="panel">
          <Question card={card} />
          {shown ? <Answer card={card} /> : <button className="btn primary" onClick={() => setShown(true)}>Show answer</button>}
          <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
            {prev ? <a className="btn ghost" href={href(`/card/${prev.id}`, q)}>‹ Previous</a> : <span />}
            {next ? <a className="btn ghost" href={href(`/card/${next.id}`, q)}>Next ›</a> : <span />}
          </div>
        </div>
      </div>
    </div>
  );
}
