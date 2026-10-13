import { useMemo } from "react";
import { filterCards, thumbUrl, type Filter } from "../data/content.ts";
import type { Content, Modality, SectionId } from "../data/types.ts";
import { href, navigate, useRoute } from "../lib/router.ts";

const MODALITIES: Modality[] = ["X-ray", "CT", "MRI", "Ultrasound", "IVU", "HSG", "RUG / MCUG / Cystogram", "Barium study", "Mammography", "Angiography", "Other"];

export function Browse({ content }: { content: Content }) {
  const { query } = useRoute();
  const f: Filter = { section: (query.get("section") ?? "") as SectionId | "", modality: (query.get("modality") ?? "") as Modality | "", query: query.get("q") ?? "" };
  const cards = useMemo(() => filterCards(content.cards, f), [content, f.section, f.modality, f.query]);
  const set = (k: keyof Filter, v: string) => navigate("/browse", { section: f.section, modality: f.modality, q: f.query, [k === "query" ? "q" : k]: v }, true);

  return (
    <div className="section-gap">
      <div>
        <h1>Browse</h1>
        <p className="lede">Every question with its answer, for revision. Use Study to test yourself.</p>
      </div>
      <div className="stack">
        <div className="filters">
          <div className="field">
            <label htmlFor="f-section">Paper</label>
            <select id="f-section" value={f.section} onChange={(e) => set("section", e.target.value)}>
              <option value="">All papers</option>
              {content.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-mod">Modality</label>
            <select id="f-mod" value={f.modality} onChange={(e) => set("modality", e.target.value)}>
              <option value="">All modalities</option>
              {MODALITIES.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-q">Search</label>
            <input id="f-q" type="search" placeholder="Diagnosis, sign, finding…" defaultValue={f.query}
              onChange={(e) => set("query", e.target.value)} />
          </div>
        </div>
        <p className="result-count" aria-live="polite">{cards.length} of {content.cards.length} questions</p>
      </div>
      {cards.length ? (
        <div className="grid">
          {cards.map((c) => (
            <a key={c.id} className="tile" href={href(`/card/${c.id}`, { section: f.section, modality: f.modality, q: f.query })}>
              {c.images.length
                ? <span className="thumb"><img src={thumbUrl(c.images[0])} alt="" loading="lazy" /></span>
                : <span className="thumb text">Text-only question</span>}
              <span className="meta"><span className="mono">{c.id}</span><span className="muted">{c.modality}</span></span>
            </a>
          ))}
        </div>
      ) : (
        <div className="empty"><h2>No questions match</h2><p className="muted">Clear the search or choose another paper or modality.</p>
          <a className="btn" href="#/browse">Show all questions</a></div>
      )}
    </div>
  );
}
