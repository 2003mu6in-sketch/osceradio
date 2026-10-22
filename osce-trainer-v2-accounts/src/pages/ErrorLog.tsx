import { useMemo, useState } from "react";
import { itemPlace, itemSections, itemTitle, kindLabel, thumbUrl } from "../data/content.ts";
import type { Card, Content, Item, Modality } from "../data/types.ts";
import { SUBJECTS, subjectName } from "../data/types.ts";
import { CAUSES, MIN_ERRORS, byModality, causeTotals, missRates, tagCounts, verdicts, type CauseCounts } from "../logic/insights.ts";
import { newId } from "../logic/progress.ts";
import { isDue, relTime, stageLabel } from "../logic/schedule.ts";
import { href, navigate, useRoute } from "../lib/router.ts";
import { useNow } from "../lib/useNow.ts";
import { deleteError, saveSession, useProgress } from "../storage/progress.ts";
import { ALL_CAUSES, ERROR_TAGS, MCQ_CAUSES, causeLabel, type ErrorEntry, type ErrorTag, type RootCause } from "../storage/types.ts";
import { Answer, Film, Question } from "../ui/CardParts.tsx";
import { McqFeedback, McqOptions, McqStem, Pictures, PhotoAnswer } from "../ui/McqParts.tsx";

const CAUSE_VAR: Record<RootCause, string> = {
  "image-familiarity": "var(--c-fam)", "knowledge-application": "var(--c-app)", "never-learnt": "var(--c-never)",
  "couldnt-recall": "var(--c-recall)", "misread-question": "var(--c-misread)", "narrowed-two": "var(--c-two)",
};
const MCQ_CAUSE_IDS = MCQ_CAUSES.map((c) => c.id) as RootCause[];
const entryKind = (e: ErrorEntry) => e.kind ?? "osce";
const tagLabel = (t: ErrorTag) => ERROR_TAGS.find((x) => x.id === t)!.label;
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function LogPage({ content }: { content: Content }) {
  const { parts } = useRoute();
  const { ready } = useProgress();
  if (!ready) return <p className="loading">Loading your error log…</p>;
  return parts[1] ? <EntryDetail content={content} id={parts[1]} /> : <LogHome content={content} />;
}

/* ================================================================== list + insights */

function LogHome({ content }: { content: Content }) {
  const { errors, reviews } = useProgress();
  const { query } = useRoute();
  const cards = useMemo(() => new Map(content.cards.map((c) => [c.id, c])), [content]);
  const f = { subject: query.get("subject") ?? "", kind: query.get("kind") ?? "", cause: query.get("cause") ?? "", tag: query.get("tag") ?? "", section: query.get("section") ?? "", modality: query.get("modality") ?? "", q: query.get("q") ?? "" };
  const setF = (k: keyof typeof f, v: string) => navigate("/log", { ...f, [k]: v, ...(k === "subject" ? { section: "", modality: "" } : {}) }, true);

  const shown = errors.filter((e) => {
    const it = content.items.get(e.cardId);
    if (f.subject && it?.card.subject !== f.subject) return false;
    if (f.kind && entryKind(e) !== f.kind) return false;
    if (f.cause && e.rootCause !== f.cause) return false;
    if (f.tag && !e.tags.includes(f.tag as ErrorTag)) return false;
    if (f.section && !(it && itemSections(it).includes(f.section))) return false;
    if (f.modality && !(it?.kind === "osce" && it.card.modality === f.modality)) return false;
    if (f.q && ![it ? itemTitle(it) : "", e.cardId, e.note, e.typedAnswer].join(" ").toLowerCase().includes(f.q.toLowerCase())) return false;
    return true;
  });
  const osceErrors = errors.filter((e) => entryKind(e) === "osce" && (!f.subject || content.items.get(e.cardId)?.card.subject === f.subject));
  const mcqErrors = errors.filter((e) => entryKind(e) !== "osce" && (!f.subject || content.items.get(e.cardId)?.card.subject === f.subject));
  const filtered = Object.values(f).some(Boolean);
  const questions = new Set(errors.map((e) => e.cardId)).size;

  if (!errors.length) {
    return (
      <div className="section-gap">
        <div><h1>Error log</h1><p className="lede">Every question you mark Wrong, with what went wrong and why.</p></div>
        <div className="empty">
          <h2>Your error log is empty</h2>
          <p className="muted">Each entry records the error type (missed finding, wrong modality, wrong diagnosis…) and the root cause: image familiarity, knowledge application, or never learnt. Once you have a few entries, this page shows which kind of mistake you make most, for each modality.</p>
          <a className="btn" href="#/">Start studying</a>
        </div>
      </div>
    );
  }

  return (
    <div className="section-gap">
      <div>
        <h1>Error log</h1>
        <p className="lede">{errors.length} {errors.length === 1 ? "entry" : "entries"} across {questions} {questions === 1 ? "question" : "questions"}.</p>
      </div>

      <div className="chips" role="group" aria-label="Subject">
        <button className={f.subject ? "chip" : "chip on"} onClick={() => setF("subject", "")}>All subjects</button>
        {SUBJECTS.map((s) => <button key={s.id} className={f.subject === s.id ? "chip on" : "chip"} onClick={() => setF("subject", s.id)}>{s.name}</button>)}
      </div>

      {mcqErrors.length > 0 && <McqInsights errors={mcqErrors} />}
      {osceErrors.length > 0 && <Insights errors={osceErrors} reviews={[...reviews.values()].filter((r) => content.items.get(r.cardId)?.kind === "osce" && (!f.subject || content.items.get(r.cardId)?.card.subject === f.subject))} cards={cards} radiology={!f.subject || f.subject === "radiology"} onModality={(m) => { setF("modality", m); document.getElementById("entries")?.scrollIntoView(); }} />}

      <section className="stack" id="entries" aria-labelledby="entries-h">
        <h2 id="entries-h">Entries</h2>
        <div className="filters log-filters">
          <div className="field">
            <label htmlFor="lf-cause">Root cause</label>
            <select id="lf-cause" value={f.cause} onChange={(e) => setF("cause", e.target.value)}>
              <option value="">All causes</option>
              {ALL_CAUSES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="lf-kind">Question type</label>
            <select id="lf-kind" value={f.kind} onChange={(e) => setF("kind", e.target.value)}>
              <option value="">All types</option>
              <option value="osce">OSCE pictures</option>
              <option value="mcq">MCQs</option>
              <option value="photo">Paper photos</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="lf-tag">Error type</label>
            <select id="lf-tag" value={f.tag} onChange={(e) => setF("tag", e.target.value)}>
              <option value="">All types</option>
              {ERROR_TAGS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="lf-section">Paper</label>
            <select id="lf-section" value={f.section} onChange={(e) => setF("section", e.target.value)}>
              <option value="">All papers</option>
              {content.sections.filter((s) => !f.subject || s.subject === f.subject).map((s) => <option key={s.id} value={s.id}>{f.subject ? "" : `${subjectName(s.subject)} · `}{s.kind === "osce" ? "" : "MCQ "}{s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="lf-mod">Modality</label>
            <select id="lf-mod" value={f.modality} onChange={(e) => setF("modality", e.target.value)}>
              <option value="">All modalities</option>
              {[...new Set(content.cards.filter((c) => c.subject === "radiology").map((c) => c.modality))].sort().map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="lf-q">Search</label>
            <input id="lf-q" type="search" placeholder="Diagnosis, note…" defaultValue={f.q} onChange={(e) => setF("q", e.target.value)} />
          </div>
        </div>
        <p className="result-count" aria-live="polite">
          {shown.length} of {errors.length} entries
          {filtered && <> · <a href="#/log">Clear filters</a></>}
        </p>
        {shown.length ? (
          <ul className="log-list">{shown.map((e) => <EntryRow key={e.id} e={e} item={content.items.get(e.cardId)} />)}</ul>
        ) : (
          <div className="empty"><h2>No entries match</h2><a className="btn" href="#/log">Clear filters</a></div>
        )}
      </section>
    </div>
  );
}

function EntryRow({ e, item }: { e: ErrorEntry; item?: Item }) {
  const img = item?.card.images[0];
  return (
    <li>
      <a className="log-row" href={href(`/log/${e.id}`)}>
        <span className="rthumb">{img ? <img src={thumbUrl(img)} alt="" loading="lazy" /> : <span className="kind-mark" aria-hidden="true">{item?.kind === "mcq" ? "MCQ" : ""}</span>}</span>
        <span className="log-main">
          <strong>{item ? itemTitle(item) : e.cardId}</strong>
          <span className="chips">
            <span className="chip small cause"><i style={{ background: CAUSE_VAR[e.rootCause] }} aria-hidden="true" />{causeLabel(e.rootCause)}</span>
            {e.tags.map((t) => <span key={t} className="chip small">{tagLabel(t)}</span>)}
          </span>
          {e.note && <span className="log-note">{e.note}</span>}
        </span>
        <span className="rmeta">
          <time dateTime={new Date(e.createdAt).toISOString()}>{fmtDate(e.createdAt)}</time>
          <span className="muted">{item ? `${subjectName(item.card.subject)} · ${kindLabel(item.kind)} · ${itemPlace(item)}` : e.cardId}</span>
        </span>
      </a>
    </li>
  );
}

/* ================================================================== insights */

function Legend({ totals, causes = CAUSES }: { totals?: CauseCounts; causes?: RootCause[] }) {
  const n = totals ? causes.reduce((s, c) => s + totals[c], 0) : 0;
  return (
    <ul className="legend" aria-label="Root causes">
      {causes.map((c) => (
        <li key={c}><i style={{ background: CAUSE_VAR[c] }} aria-hidden="true" />{causeLabel(c)}
          {totals && <b>{totals[c]} <span className="muted">({pct(totals[c], n)}%)</span></b>}</li>
      ))}
    </ul>
  );
}

/** Horizontal stacked bar. `max` sets the scale so rows are comparable; segments carry a hover/focus tooltip. */
function StackBar({ counts, max, label, causes = CAUSES }: { counts: CauseCounts; max: number; label: string; causes?: RootCause[] }) {
  const total = causes.reduce((s, c) => s + counts[c], 0);
  return (
    <div className="stack-track" role="img" aria-label={`${label}: ${causes.map((c) => `${causeLabel(c)} ${counts[c]}`).join(", ")}`}>
      <div className="stack-fill" style={{ width: `${(100 * total) / max}%` }}>
        {causes.filter((c) => counts[c] > 0).map((c) => (
          <span key={c} className="seg" tabIndex={0} style={{ flexGrow: counts[c], background: CAUSE_VAR[c] }}
            data-tip={`${label} · ${causeLabel(c)}: ${counts[c]} (${pct(counts[c], total)}%)`} />
        ))}
      </div>
    </div>
  );
}

/** MCQ and paper-photo mistakes: why you got them wrong. */
function McqInsights({ errors }: { errors: ErrorEntry[] }) {
  const totals = causeTotals(errors);
  const n = errors.length;
  const top = [...MCQ_CAUSE_IDS].sort((a, b) => totals[b] - totals[a])[0];
  const advice: Partial<Record<RootCause, string>> = {
    "never-learnt": "most of these are topics you have not covered yet. Read them up before doing more questions.",
    "couldnt-recall": "you have learnt these but they did not come back. Spaced review will help: keep doing your due reviews.",
    "misread-question": "you are losing marks on the wording. Slow down on EXCEPT, NOT and FALSE stems and underline them.",
    "narrowed-two": "you get close but choose the wrong one of two. When you review, write down why the other option is wrong.",
  };
  return (
    <section className="insights" aria-labelledby="mcq-ins-h">
      <h2 id="mcq-ins-h">Your MCQ mistakes</h2>
      <ul className="verdicts"><li>{n < MIN_ERRORS
        ? `Log at least ${MIN_ERRORS} MCQ mistakes to see a pattern – you have ${n} so far.`
        : totals[top] / n >= 0.4 ? `${totals[top]} of your ${n} MCQ mistakes are “${causeLabel(top).toLowerCase()}”: ${advice[top]}`
        : `Your MCQ mistakes are spread across causes: ${MCQ_CAUSE_IDS.map((c) => `${causeLabel(c).toLowerCase()} ${totals[c]}`).join(", ")}.`}</li></ul>
      <div className="panel ins-card">
        <h3>Cause</h3>
        <p className="muted ins-sub">Why you got it wrong, across {n} MCQ and paper-photo {n === 1 ? "entry" : "entries"}</p>
        <StackBar counts={totals} max={n} label="MCQ entries" causes={MCQ_CAUSE_IDS} />
        <Legend totals={totals} causes={MCQ_CAUSE_IDS} />
      </div>
    </section>
  );
}

function Insights({ errors, reviews, cards, onModality, radiology }: {
  errors: ErrorEntry[]; reviews: Parameters<typeof missRates>[0]; cards: Map<string, Card>; onModality: (m: Modality) => void; radiology: boolean;
}) {
  const [table, setTable] = useState(false);
  const totals = causeTotals(errors);
  const rows = byModality(errors, cards);
  const tags = tagCounts(errors);
  const rates = missRates(reviews, cards);
  const lines = verdicts(errors, cards);
  const maxRow = Math.max(...rows.map((r) => r.total));
  const maxTag = Math.max(...tags.map((t) => t.count), 1);

  return (
    <section className="insights" aria-labelledby="ins-h">
      <h2 id="ins-h">Your OSCE picture mistakes</h2>
      <ul className="verdicts">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>

      <div className="ins-grid">
        <div className="panel ins-card">
          <h3>Root cause</h3>
          <p className="muted ins-sub">Why you got it wrong, across all {errors.length} entries</p>
          <StackBar counts={totals} max={CAUSES.reduce((s, c) => s + totals[c], 0)} label="All entries" />
          <Legend totals={totals} />
        </div>

        <div className="panel ins-card">
          <h3>Error type</h3>
          <p className="muted ins-sub">What went wrong (an entry can have several)</p>
          <ul className="barlist">
            {tags.map((t) => (
              <li key={t.tag}>
                <span className="bl-label">{tagLabel(t.tag)}</span>
                <span className="bl-track"><span className="bl-bar" style={{ width: `${(100 * t.count) / maxTag}%` }} tabIndex={0} data-tip={`${tagLabel(t.tag)}: ${t.count}`} /></span>
                <span className="bl-val">{t.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {radiology && <>
      <div className="panel ins-card">
        <div className="ins-head">
          <div>
            <h3>Root cause by modality</h3>
            <p className="muted ins-sub">Entries per modality, split by root cause. Select a modality to list its entries.</p>
          </div>
          <button className="btn small ghost" aria-pressed={table} onClick={() => setTable(!table)}>{table ? "Show chart" : "Show as table"}</button>
        </div>
        {!table ? (
          <>
            <Legend />
            <ul className="mod-rows">
              {rows.map((r) => (
                <li key={r.modality}>
                  <button className="mod-name" onClick={() => onModality(r.modality)}>{r.modality}</button>
                  <StackBar counts={r.causes} max={maxRow} label={r.modality} />
                  <span className="bl-val">{r.total}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th scope="col">Modality</th>{CAUSES.map((c) => <th key={c} scope="col">{causeLabel(c)}</th>)}<th scope="col">Total</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.modality}><th scope="row">{r.modality}</th>{CAUSES.map((c) => <td key={c}>{r.causes[c]}</td>)}<td>{r.total}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel ins-card">
        <h3>Miss rate by modality</h3>
        <p className="muted ins-sub">Share of your attempts marked Wrong. Shown once a modality has at least 3 attempts.</p>
        {rates.length ? (
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th scope="col">Modality</th><th scope="col">Attempts</th><th scope="col">Wrong</th><th scope="col">Miss rate</th></tr></thead>
              <tbody>{rates.map((r) => (
                <tr key={r.modality}><th scope="row">{r.modality}</th><td>{r.attempts}</td><td>{r.misses}</td>
                  <td><span className="rate"><span className="rate-track" aria-hidden="true"><span className="rate-bar" style={{ width: `${Math.round(r.rate * 100)}%` }} /></span>{Math.round(r.rate * 100)}%</span></td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>Study a few more questions per modality to see this.</p>}
      </div>
      </>}
      {errors.length < MIN_ERRORS && <p className="hint">Patterns appear once you have {MIN_ERRORS} or more entries.</p>}
    </section>
  );
}

/* ================================================================== entry detail */

function EntryDetail({ content, id }: { content: Content; id: string }) {
  const { errors, reviews } = useProgress();
  const now = useNow();
  const [confirm, setConfirm] = useState(false);
  const e = errors.find((x) => x.id === id);
  if (!e) return <div className="empty"><h2>Entry not found</h2><p className="muted">It may have been deleted.</p><a className="btn" href="#/log">Back to the error log</a></div>;
  const item = content.items.get(e.cardId);
  const card = item?.kind === "osce" ? item.card : undefined;
  const r = reviews.get(e.cardId);
  const history = errors.filter((x) => x.cardId === e.cardId);

  const studyAgain = async () => {
    const t = Date.now();
    await saveSession({ id: newId(), title: `Error log · ${e.cardId}`, filter: { retryOf: e.id }, order: [e.cardId], index: 0, results: {}, startedAt: t, updatedAt: t });
    navigate("/study/run");
  };
  const remove = async () => { await deleteError(e.id); navigate("/log", undefined, true); };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="crumbs"><a href="#/log">‹ Error log</a><span className="muted">·</span><span className="mono">{item && item.kind !== "osce" ? itemPlace(item) : e.cardId}</span>
        {item && <span className="chip small">{subjectName(item.card.subject)} · {kindLabel(item.kind)}</span>}
        {card && card.subject === "radiology" && <span className="chip small accent">{card.modality}</span>}</div>
      <div className="card-view">
        {card ? <Film card={card} content={content} />
          : item?.kind === "mcq" ? <div className="panel"><McqStem card={item.card} content={content} />{item.card.type === "mcq" && <McqOptions card={item.card} chosen={e.chosen ?? item.card.correct[0] ?? null} onChoose={() => {}} reference={!e.chosen} />}{e.chosen && item.card.type === "mcq" && <McqFeedback card={item.card} chosen={e.chosen} />}</div>
          : item?.kind === "photo" ? <div className="panel"><Pictures ids={item.card.images} content={content} alt="Photo of the question" /><PhotoAnswer card={item.card} /></div>
          : <div className="empty">This question is no longer in the bank.</div>}
        <div className="stack">
          <div className="panel">
            <div>
              <p className="label">Your mistake · {fmtDate(e.createdAt)}</p>
              <p className="dx" style={{ margin: "0 0 10px" }}>{item ? (item.kind === "osce" ? (item.card.diagnosis ?? e.cardId) : item.kind === "mcq" && e.chosen ? `You chose ${e.chosen}` : itemTitle(item)) : e.cardId}</p>
              <div className="chips">
                <span className="chip small cause"><i style={{ background: CAUSE_VAR[e.rootCause] }} aria-hidden="true" />{causeLabel(e.rootCause)}</span>
                {e.tags.map((t) => <span key={t} className="chip small">{tagLabel(t)}</span>)}
              </div>
            </div>
            {e.typedAnswer && <div className="typed"><p className="label">You wrote</p><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{e.typedAnswer}</p></div>}
            {e.note && <div><p className="label">Note</p><p style={{ margin: 0 }}>{e.note}</p></div>}
            <div>
              <p className="label">Review</p>
              <p style={{ margin: 0 }}>{!r || r.stage === 0 ? "Not scheduled"
                : r.stage === "mastered" ? "Mastered"
                : `${stageLabel(r.stage)} – ${isDue(r, now) ? "due now" : relTime(r.dueAt!, now)}`}
                {r && <span className="muted"> · {r.misses} wrong, {r.rights} right so far</span>}</p>
            </div>
            <div className="detail-actions">
              <button className="btn primary" onClick={studyAgain}>Study this question again</button>
              {!confirm
                ? <button className="btn ghost" onClick={() => setConfirm(true)}>Delete entry</button>
                : <span className="confirm" role="alert">Delete this entry? Its review schedule stays.
                    <button className="btn small danger" onClick={remove}>Delete</button>
                    <button className="btn small ghost" onClick={() => setConfirm(false)}>Keep</button></span>}
            </div>
          </div>
          {history.length > 1 && (
            <div className="panel">
              <p className="label">All mistakes on this question ({history.length})</p>
              <ul className="history">{history.map((h) => (
                <li key={h.id} aria-current={h.id === e.id ? "true" : undefined}>
                  <a href={href(`/log/${h.id}`)}>{fmtDate(h.createdAt)}</a> · {causeLabel(h.rootCause)}{h.tags.length ? ` · ${h.tags.map(tagLabel).join(", ")}` : ""}{h.chosen ? ` · chose ${h.chosen}` : ""}
                </li>))}
              </ul>
            </div>
          )}
          {card && (
            <details className="panel">
              <summary>Question and answer</summary>
              <Question card={card} />
              <Answer card={card} />
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
