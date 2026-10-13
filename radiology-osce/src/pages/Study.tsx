import { useEffect, useMemo, useRef, useState } from "react";
import type { Card, Content, Modality, SectionId } from "../data/types.ts";
import { buildDeck, deckTitle } from "../logic/deck.ts";
import { newId } from "../logic/progress.ts";
import { href, navigate, useRoute } from "../lib/router.ts";
import { recordResult, saveSession, undoResult, useProgress, type Recorded } from "../storage/progress.ts";
import { useSettings } from "../storage/settings.ts";
import type { StudySession } from "../storage/types.ts";
import { Answer, Film, Question } from "../ui/CardParts.tsx";
import { WrongDialog, type WrongInput } from "../ui/WrongDialog.tsx";
import { isDue, relTime, stageLabel } from "../logic/schedule.ts";

/** #/study?section=… → choose options;  #/study/run → the session. */
export function StudyPage({ content }: { content: Content }) {
  const { parts } = useRoute();
  const { ready, session } = useProgress();
  if (!ready) return <p className="loading">Loading your progress…</p>;
  if (parts[1] === "run") {
    if (!session) return <div className="empty"><h2>No study session</h2><a className="btn primary" href="#/">Choose questions to study</a></div>;
    return session.index >= session.order.length
      ? <Summary content={content} session={session} />
      : <Runner content={content} session={session} />;
  }
  return <Setup content={content} />;
}

/* ------------------------------------------------------------------ setup */

function Setup({ content }: { content: Content }) {
  const { query } = useRoute();
  const settings = useSettings();
  const { reviews, session } = useProgress();
  const section = (query.get("section") ?? "") as SectionId | "";
  const modality = (query.get("modality") ?? "") as Modality | "";
  const [shuffleOn, setShuffle] = useState(settings.shuffle);
  const [unseenOnly, setUnseen] = useState(false);
  const sectionName = content.sections.find((s) => s.id === section)?.name;
  const title = deckTitle(sectionName, modality, unseenOnly);
  const all = useMemo(() => buildDeck(content.cards, reviews, { section, modality }), [content, reviews, section, modality]);
  const unseen = all.filter((c) => !reviews.get(c.id)?.seen).length;
  const count = unseenOnly ? unseen : all.length;
  const same = session && session.filter.section === (section || undefined) && session.filter.modality === (modality || undefined)
    && !session.filter.retryOf && session.index < session.order.length;

  const start = async () => {
    const deck = buildDeck(content.cards, reviews, { section, modality, unseenOnly, shuffle: shuffleOn, seed: Date.now() });
    const now = Date.now();
    await saveSession({
      id: newId(), title, filter: { section: section || undefined, modality: modality || undefined, unseenOnly },
      order: deck.map((c) => c.id), index: 0, results: {}, startedAt: now, updatedAt: now,
    });
    navigate("/study/run");
  };

  return (
    <div className="section-gap" style={{ maxWidth: 720 }}>
      <div>
        <p className="eyebrow">Study</p>
        <h1>{deckTitle(sectionName, modality)}</h1>
        <p className="lede">{all.length} questions · {all.length - unseen} seen · {unseen} not yet seen</p>
      </div>

      {same && (
        <div className="panel">
          <h2>Continue where you left off</h2>
          <div className="meter" aria-hidden="true"><i style={{ width: `${(100 * session!.index) / session!.order.length}%` }} /></div>
          <p className="muted" style={{ margin: 0 }}>Question {session!.index + 1} of {session!.order.length}</p>
          <a className="btn primary" href="#/study/run">Continue</a>
        </div>
      )}

      <div className="panel">
        <h2>{same ? "Or start again" : "Options"}</h2>
        <label className="switch" htmlFor="opt-shuffle">
          <span>Shuffle the order</span>
          <input id="opt-shuffle" type="checkbox" checked={shuffleOn} onChange={(e) => setShuffle(e.target.checked)} />
        </label>
        <label className="switch" htmlFor="opt-unseen">
          <span>Only questions I haven't seen <span className="muted">({unseen})</span></span>
          <input id="opt-unseen" type="checkbox" checked={unseenOnly} onChange={(e) => setUnseen(e.target.checked)} />
        </label>
        <button className={same ? "btn" : "btn primary"} disabled={count === 0} onClick={start}>
          {count === 0 ? "Nothing left to study here" : `Start ${count} question${count === 1 ? "" : "s"}`}
        </button>
      </div>
      <a href={href("/browse", { section, modality })}>Revise these questions in Browse instead ›</a>
    </div>
  );
}

/* ----------------------------------------------------------------- runner */

type Phase = "question" | "revealed" | "logging";

function Runner({ content, session }: { content: Content; session: StudySession }) {
  const settings = useSettings();
  const card = content.cards.find((c) => c.id === session.order[session.index]) as Card | undefined;
  // Phase and typed text belong to one question: when the question changes they reset in the
  // same render (no frame where the next card shows as "revealed").
  const cardKey = card?.id ?? "";
  const [st, setSt] = useState<{ key: string; phase: Phase; typed: string }>({ key: cardKey, phase: "question", typed: "" });
  const phase: Phase = st.key === cardKey ? st.phase : "question";
  const typed = st.key === cardKey ? st.typed : "";
  const setPhase = (p: Phase) => setSt((o) => ({ key: cardKey, phase: p, typed: o.key === cardKey ? o.typed : "" }));
  const setTyped = (t: string) => setSt((o) => ({ key: cardKey, phase: o.key === cardKey ? o.phase : "question", typed: t }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ r: Recorded; label: string } | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const revealBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => { setError(null); window.scrollTo(0, 0); }, [cardKey]);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  const mark = async (result: "right" | "wrong", input?: WrongInput) => {
    if (!card || saving) return;
    setSaving(true);
    try {
      const r = await recordResult(card.id, result, result === "wrong" ? input : undefined);
      setUndo({ r, label: result === "right" ? "Marked right" : "Saved to error log" });
      window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setUndo(null), 7000);
    } catch (e) {
      setError(`Not saved: ${(e as Error).message}`);
      if (result === "wrong") setPhase("logging");
    } finally { setSaving(false); }
  };

  const doUndo = async () => {
    if (!undo) return;
    window.clearTimeout(undoTimer.current);
    await undoResult(undo.r);
    setUndo(null);
  };

  // One listener for the whole session; it always calls the latest handler (no gap after a re-render).
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e: KeyboardEvent) => {
    if (phase === "logging" || e.ctrlKey || e.metaKey || e.altKey) return;
    const typing = (e.target as HTMLElement).tagName === "TEXTAREA" || (e.target as HTMLElement).tagName === "INPUT";
    if (phase === "question") {
      if (typing) return;   // Ctrl+Enter inside the answer box is handled on the textarea
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); setPhase("revealed"); }
    } else if (phase === "revealed" && !typing) {
      if (e.key === "r" || e.key === "R") { e.preventDefault(); mark("right"); }
      if (e.key === "w" || e.key === "W") { e.preventDefault(); setPhase("logging"); }
    }
    if (!typing && (e.key === "u" || e.key === "U") && undo) { e.preventDefault(); doUndo(); }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  if (!card) {
    return <div className="empty"><h2>This question is no longer in the bank</h2>
      <button className="btn" onClick={() => saveSession({ ...session, index: session.index + 1 })}>Skip it</button></div>;
  }

  const done = session.index, total = session.order.length;
  return (
    <div className="study">
      <div className="study-head">
        <a href="#/" className="btn ghost small" aria-label="Exit study (progress is kept)">✕ Exit</a>
        <div className="study-progress">
          <span>{session.title}</span>
          <div className="meter" aria-hidden="true"><i style={{ width: `${(100 * done) / total}%` }} /></div>
        </div>
        <span className="count mono" aria-label={`Question ${done + 1} of ${total}`}>{done + 1}/{total}</span>
      </div>

      <div className="card-view">
        <Film card={card} content={content} />
        <div className="panel">
          <div className="crumbs">
            <span className="mono">{card.id}</span>
            {phase !== "question" && <span className="chip small accent">{card.modality}</span>}
            <ReviewChip cardId={card.id} />
          </div>
          <Question card={card} />

          {phase === "question" && (
            <>
              {settings.typedAnswerBox && (
                <div className="field">
                  <label htmlFor="typed">Your answer <span className="muted">(optional)</span></label>
                  <textarea id="typed" rows={3} value={typed} onChange={(e) => setTyped(e.target.value)}
                    placeholder="Modality, findings, diagnosis…"
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setPhase("revealed"); } }} />
                </div>
              )}
              <button ref={revealBtn} className="btn primary" onClick={() => setPhase("revealed")}>Reveal answer</button>
              <p className="hint">Space to reveal{settings.typedAnswerBox ? " · Ctrl+Enter from the answer box" : ""}</p>
            </>
          )}

          {phase !== "question" && (
            <>
              {typed.trim() && (
                <div className="typed"><p className="label">Your answer</p><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{typed.trim()}</p></div>
              )}
              <Answer card={card} />
            </>
          )}
          {error && <p className="notice" role="alert">{error}</p>}
        </div>
      </div>

      {phase !== "question" && (
        <div className="mark-bar" role="group" aria-label="Mark your answer">
          <button className="btn mark wrong" disabled={saving} onClick={() => setPhase("logging")}><span aria-hidden="true">✗</span> Wrong <kbd>W</kbd></button>
          <button className="btn mark right" disabled={saving} onClick={() => mark("right")}><span aria-hidden="true">✓</span> Right <kbd>R</kbd></button>
        </div>
      )}

      {phase === "logging" && (
        <WrongDialog card={card} typedAnswer={typed} saving={saving}
          onCancel={() => setPhase("revealed")}
          onSave={(v) => mark("wrong", v)} />
      )}

      {undo && phase !== "logging" && (
        <div className="toast" role="status">
          <span>{undo.label}</span>
          <button onClick={doUndo}>Undo</button>
        </div>
      )}
    </div>
  );
}

/** Shows where this question is in its review cycle (only for questions that have been missed before). */
function ReviewChip({ cardId }: { cardId: string }) {
  const { reviews } = useProgress();
  const r = reviews.get(cardId);
  if (!r || r.stage === 0) return null;
  if (r.stage === "mastered") return <span className="chip small" style={{ color: "var(--right)", borderColor: "var(--right)" }}>Mastered</span>;
  const now = Date.now();
  return <span className="chip small warn" title={isDue(r, now) ? "Due now – a right answer moves it on" : `Not due yet – it still comes back ${relTime(r.dueAt!, now)}`}>
    {stageLabel(r.stage)}{isDue(r, now) ? " · due" : ""}</span>;
}

/* ---------------------------------------------------------------- summary */

function Summary({ content, session }: { content: Content; session: StudySession }) {
  const ids = session.order;
  const right = ids.filter((id) => session.results[id] === "right").length;
  const wrongIds = ids.filter((id) => session.results[id] === "wrong");
  const wrongCards = wrongIds.map((id) => content.cards.find((c) => c.id === id)).filter(Boolean) as Card[];
  const pct = ids.length ? Math.round((100 * right) / ids.length) : 0;

  const retry = async () => {
    const now = Date.now();
    await saveSession({
      id: newId(), title: `Retry: ${session.title.replace(/^Retry: /, "")}`, filter: { ...session.filter, retryOf: session.id },
      order: wrongIds, index: 0, results: {}, startedAt: now, updatedAt: now,
    });
  };

  return (
    <div className="section-gap" style={{ maxWidth: 720 }}>
      <div>
        <p className="eyebrow">Session complete</p>
        <h1>{session.title}</h1>
      </div>
      <div className="hero-stats">
        <div><b>{ids.length}</b><span>questions</span></div>
        <div><b style={{ color: "var(--right)" }}>{right}</b><span>right</span></div>
        <div><b style={{ color: "var(--wrong)" }}>{wrongIds.length}</b><span>wrong</span></div>
        <div><b>{pct}%</b><span>score</span></div>
      </div>
      {wrongCards.length > 0 ? (
        <div className="panel">
          <h2>{session.filter.review ? "Back to the start of the cycle" : "Saved to your error log"}</h2>
          <p className="muted" style={{ margin: 0 }}>These come back for review in 48 hours.</p>
          <ul className="wrong-list">
            {wrongCards.map((c) => <li key={c.id}><a href={href(`/card/${c.id}`)}><span className="mono">{c.id}</span> {c.diagnosis ?? c.modality}</a></li>)}
          </ul>
          <button className="btn primary" onClick={retry}>Retry the {wrongCards.length} I got wrong now</button>
          <p className="hint">Practice only: a right answer now doesn't move them on – they still come back in 48 hours.</p>
        </div>
      ) : (
        <div className="panel"><h2>No mistakes in this set</h2><p className="muted" style={{ margin: 0 }}>{session.filter.review
          ? "Each one moves on: from the 1st review to the 2nd (in 72 hours), or from the 2nd review to mastered."
          : "Nothing was added to your error log."}</p></div>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <a className="btn" href="#/" onClick={() => saveSession(null)}>Study another set</a>
        <a className="btn ghost" href="#/log">Open error log</a>
      </div>
    </div>
  );
}
