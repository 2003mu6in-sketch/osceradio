import { useMemo } from "react";
import { filterCards, thumbUrl } from "../data/content.ts";
import type { Content, Modality, SectionId, Subject } from "../data/types.ts";
import { SUBJECTS } from "../data/types.ts";
import { href, navigate, useRoute } from "../lib/router.ts";
import { useSettings } from "../storage/settings.ts";

const MODALITIES: Modality[] = ["X-ray", "CT", "MRI", "Ultrasound", "IVU", "HSG", "RUG / MCUG / Cystogram", "Barium study", "Mammography", "Angiography", "Other"];

export function Browse({ content }: { content: Content }) {
  const { query } = useRoute();
  const settings = useSettings();
  const subject = (SUBJECTS.some((s) => s.id === query.get("subject")) ? query.get("subject") : settings.subject) as Subject;
  const kind = query.get("kind") === "mcq" ? "mcq" : "osce";
  const section = (query.get("section") ?? "") as SectionId | "";
  const modality = (query.get("modality") ?? "") as Modality | "";
  const q = query.get("q") ?? "";
  const params = { subject, kind: kind === "mcq" ? "mcq" : "", section, modality, q };
  const set = (k: keyof typeof params, v: string) => {
    const next = { ...params, [k]: v };
    if (k === "subject" || k === "kind") { next.section = ""; next.modality = ""; }
    navigate("/browse", next, true);
  };

  const cards = useMemo(() => filterCards(content.cards, { subject, section, modality, query: q }), [content, subject, section, modality, q]);
  const mcqs = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return content.mcqs.filter((c) => c.subject === subject && (!section || c.section === section) &&
      (!ql || [c.stem, c.leadIn ?? "", ...c.options.map((o) => o.text), c.paper].join(" ").toLowerCase().includes(ql)));
  }, [content, subject, section, q]);
  const sections = content.sections.filter((s) => s.subject === subject && (kind === "osce" ? s.kind === "osce" : s.kind !== "osce"));
  const total = kind === "osce" ? content.cards.filter((c) => c.subject === subject).length : content.mcqs.filter((c) => c.subject === subject).length;
  const shown = kind === "osce" ? cards.length : mcqs.length;

  return (
    <div className="section-gap">
      <div>
        <h1>Browse</h1>
        <p className="lede">Every question with its answer, for revision. Use Study to test yourself.</p>
      </div>
      <div className="stack">
        <div className="filters">
          <div className="field">
            <label htmlFor="f-subject">Subject</label>
            <select id="f-subject" value={subject} onChange={(e) => set("subject", e.target.value)}>
              {SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-kind">Type</label>
            <select id="f-kind" value={kind} onChange={(e) => set("kind", e.target.value === "mcq" ? "mcq" : "")}>
              <option value="osce">OSCE pictures</option>
              <option value="mcq">MCQs</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-section">Paper</label>
            <select id="f-section" value={section} onChange={(e) => set("section", e.target.value)}>
              <option value="">All papers</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {kind === "osce" && subject === "radiology" && (
            <div className="field">
              <label htmlFor="f-mod">Modality</label>
              <select id="f-mod" value={modality} onChange={(e) => set("modality", e.target.value)}>
                <option value="">All modalities</option>
                {MODALITIES.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="f-q">Search</label>
            <input id="f-q" type="search" placeholder={kind === "osce" ? "Diagnosis, sign, finding…" : "Words in the question or options…"} defaultValue={q}
              onChange={(e) => set("q", e.target.value)} />
          </div>
        </div>
        <p className="result-count" aria-live="polite">{shown} of {total} questions</p>
      </div>
      {shown === 0 ? (
        <div className="empty"><h2>No questions match</h2><p className="muted">Clear the search or choose another paper.</p>
          <a className="btn" href={href("/browse", { subject, kind: kind === "mcq" ? "mcq" : "" })}>Show all</a></div>
      ) : kind === "osce" ? (
        <div className="grid">
          {cards.map((c) => (
            <a key={c.id} className="tile" href={href(`/card/${c.id}`, { subject, section, modality, q })}>
              {c.images.length
                ? <span className="thumb"><img src={thumbUrl(c.images[0])} alt="" loading="lazy" /></span>
                : <span className="thumb text">Text-only question</span>}
              <span className="meta"><span className="mono">{c.id}</span><span className="muted">{subject === "radiology" ? c.modality : (c.appearsIn[0] ?? "")}</span></span>
            </a>
          ))}
        </div>
      ) : (
        <ul className="mcq-list">
          {mcqs.slice(0, 300).map((c) => (
            <li key={c.id}>
              <a href={href(`/card/${c.id}`, { subject, section, kind: "mcq" })}>
                <span className="mono muted">{c.paper} Q{c.qNumber}</span>
                <span>{c.stem}</span>
              </a>
            </li>
          ))}
          {mcqs.length > 300 && <li className="muted" style={{ padding: 12 }}>Showing the first 300. Choose a paper or search to narrow the list.</li>}
        </ul>
      )}
    </div>
  );
}
