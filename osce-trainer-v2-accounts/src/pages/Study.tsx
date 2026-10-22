import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Card, Content, Item, Kind, McqCard, Modality, PhotoCard, Subject } from "../data/types.ts";
import { SUBJECTS, subjectName } from "../data/types.ts";
import { itemPlace, itemTitle, kindLabel } from "../data/content.ts";
import { itemDeck, itemDeckTitle } from "../logic/deck.ts";
import { newId } from "../logic/progress.ts";
import { href, navigate, useRoute } from "../lib/router.ts";
import { recordResult, saveSession, undoResult, useProgress, type Recorded } from "../storage/progress.ts";
import { useSettings } from "../storage/settings.ts";
import type { ErrorEntry, StudySession } from "../storage/types.ts";
import { Answer, Film, Question } from "../ui/CardParts.tsx";
import { WrongDialog } from "../ui/WrongDialog.tsx";
import { CauseDialog } from "../ui/CauseDialog.tsx";
import { McqFeedback, McqOptions, McqStem, Pictures, PhotoAnswer } from "../ui/McqParts.tsx";
import { isDue, relTime, stageLabel } from "../logic/schedule.ts";

/** #/study?subject=…&kind=…&section=… → choose options;  #/study/run → the session. */
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
  const subjectQ = query.get("subject") ?? "";
  const subject = (SUBJECTS.some((s) => s.id === subjectQ) ? subjectQ : "") as Subject | "";
  const kind = (["osce", "mcq", "photo"].includes(query.get("kind") ?? "") ? query.get("kind") : "") as Kind | "";
  const section = query.get("section") ?? "";
  const modality = (query.get("modality") ?? "") as Modality | "";
  const [shuffleOn, setShuffle] = useState(settings.shuffle);
  const [mode, setMode] = useState<"all" | "unseen" | "wrong">("all");
  const sectionName = content.sections.find((s) => s.id === section)?.name;
  const filter = { subject, kind, section, modality };
  const all = useMemo(() => itemDeck(content, reviews, filter), [content, reviews, subject, kind, section, modality]);
  const unseen = all.filter((it) => !reviews.get(it.card.id)?.seen).length;
  const wrongBefore = all.filter((it) => (reviews.get(it.card.id)?.misses ?? 0) > 0).length;
  const count = mode === "unseen" ? unseen : mode === "wrong" ? wrongBefore : all.length;
  const kinds = new Set(all.map((it) => it.kind));
  const title = itemDeckTitle(subject ? subjectName(subject) : undefined, kind, sectionName, modality, { unseenOnly: mode === "unseen", wrongOnly: mode === "wrong" });
  const f = session?.filter;
  const same = session && f && (f.subject ?? "") === subject && (f.kind ?? "") === kind && (f.section ?? "") === section && (f.modality ?? "") === modality
    && !f.retryOf && !f.review && session.index < session.order.length;

  const start = async () => {
    const deck = itemDeck(content, reviews, { ...filter, unseenOnly: mode === "unseen", wrongOnly: mode === "wrong", shuffle: shuffleOn, seed: Date.now() });
    const now = Date.now();
    await saveSession({
      id: newId(), title,
      filter: { subject: subject || undefined, kind: kind || undefined, section: section || undefined, modality: modality || undefined, unseenOnly: mode === "unseen", wrongOnly: mode === "wrong" },
      order: deck.map((it) => it.card.id), index: 0, results: {}, startedAt: now, updatedAt: now,
    });
    navigate("/study/run");
  };

  return (
    <div className="section-gap" style={{ maxWidth: 720 }}>
      <div>
        <p className="eyebrow">Study</p>
        <h1>{itemDeckTitle(subject ? subjectName(subject) : undefined, kind, sectionName, modality)}</h1>
        <p className="lede">{all.length} questions · {all.length - unseen} seen · {unseen} not yet seen
          {kinds.size > 1 && <> · {[...kinds].map((k) => `${all.filter((it) => it.kind === k).length} ${kindLabel(k)}${k === "mcq" ? "s" : ""}`).join(", ")}</>}</p>
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
        <fieldset className="fs">
          <legend>Which questions</legend>
          <div className="segmented wrap" role="group" aria-label="Which questions">
            {([["all", `All (${all.length})`], ["unseen", `Not seen yet (${unseen})`], ["wrong", `Got wrong before (${wrongBefore})`]] as const).map(([m, label]) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>{label}</button>
            ))}
          </div>
        </fieldset>
        <label className="switch" htmlFor="opt-shuffle">
          <span>Shuffle the order</span>
          <input id="opt-shuffle" type="checkbox" checked={shuffleOn} onChange={(e) => setShuffle(e.target.checked)} />
        </label>
        <button className={same ? "btn" : "btn primary"} disabled={count === 0} onClick={start}>
          {count === 0 ? "Nothing to study here" : `Start ${count} question${count === 1 ? "" : "s"}`}
        </button>
      </div>
      {(kind === "osce" || !kind) && <a href={href("/browse", { subject, section, modality })}>Revise these questions in Browse instead ›</a>}
    </div>
  );
}

/* ----------------------------------------------------------------- runner */

type Phase = "question" | "revealed" | "logging";

interface MarkInput { rootCause: ErrorEntry["rootCause"]; tags?: ErrorEntry["tags"]; note?: string; typedAnswer?: string; chosen?: string }

function Runner({ content, session }: { content: Content; session: StudySession }) {
  const settings = useSettings();
  const item = content.items.get(session.order[session.index]);
  // Per-question state resets in the same render when the question changes (no frame where the next one shows as answered).
  const key = item?.card.id ?? "";
  const [st, setSt] = useState<{ key: string; phase: Phase; typed: string; chosen: string | null }>({ key, phase: "question", typed: "", chosen: null });
  const cur = st.key === key ? st : { key, phase: "question" as Phase, typed: "", chosen: null };
  const set = (p: Partial<typeof cur>) => setSt((o) => ({ ...(o.key === key ? o : { key, phase: "question" as Phase, typed: "", chosen: null }), ...p }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ r: Recorded; label: string } | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);

  useEffect(() => { setError(null); window.scrollTo(0, 0); }, [key]);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  const mark = async (result: "right" | "wrong", input?: MarkInput) => {
    if (!item || saving) return;
    setSaving(true);
    try {
      const entry = result === "wrong" && input
        ? { kind: item.kind, tags: input.tags ?? [], rootCause: input.rootCause, note: input.note, typedAnswer: input.typedAnswer, chosen: input.chosen }
        : undefined;
      const r = await recordResult(item.card.id, result, entry);
      setUndo({ r, label: result === "right" ? "Marked right" : "Saved to error log" });
      window.clearTimeout(undoTimer.current);
      undoTimer.current = window.setTimeout(() => setUndo(null), 7000);
    } catch (e) {
      setError(`Not saved: ${(e as Error).message}`);
      if (result === "wrong") set({ phase: "logging" });
    } finally { setSaving(false); }
  };

  const doUndo = async () => {
    if (!undo) return;
    window.clearTimeout(undoTimer.current);
    await undoResult(undo.r);
    setUndo(null);
  };

  /** MCQ: right/wrong is known from the tapped option (or self-marked when the source has no key). */
  const mcqRight = (c: McqCard, chosen: string | null) => chosen !== null && !c.noKey && c.accepted.includes(chosen);

  // One listener for the whole session; it always calls the latest handler.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e: KeyboardEvent) => {
    if (!item || cur.phase === "logging" || e.ctrlKey || e.metaKey || e.altKey) return;
    const typing = ["TEXTAREA", "INPUT"].includes((e.target as HTMLElement).tagName);
    if (typing) return;
    const k = e.key.toUpperCase();
    if (k === "U" && undo) { e.preventDefault(); doUndo(); return; }
    if (item.kind === "mcq" && item.card.type === "mcq") {
      const c = item.card;
      if (cur.chosen === null) {
        const idx = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : c.options.findIndex((o) => o.key === k);
        if (idx >= 0 && idx < c.options.length) { e.preventDefault(); set({ chosen: c.options[idx].key, phase: "revealed" }); }
        return;
      }
      if (c.noKey) {
        if (k === "R") { e.preventDefault(); mark("right"); }
        if (k === "W") { e.preventDefault(); set({ phase: "logging" }); }
        return;
      }
      if (e.key === "Enter" || e.key === " " || k === "N") {
        e.preventDefault();
        if (mcqRight(c, cur.chosen)) mark("right"); else set({ phase: "logging" });
      }
      return;
    }
    // OSCE, short-answer MCQ and paper photo: reveal, then self-mark
    if (cur.phase === "question") {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); set({ phase: "revealed" }); }
    } else if (cur.phase === "revealed") {
      if (k === "R") { e.preventDefault(); mark("right"); }
      if (k === "W") { e.preventDefault(); set({ phase: "logging" }); }
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (!item) {
    return <div className="empty"><h2>This question is no longer in the bank</h2>
      <button className="btn" onClick={() => saveSession({ ...session, index: session.index + 1 })}>Skip it</button></div>;
  }

  const done = session.index, total = session.order.length;
  const head = (
    <div className="study-head">
      <a href="#/" className="btn ghost small" aria-label="Exit study (progress is kept)">✕ Exit</a>
      <div className="study-progress">
        <span>{session.title}</span>
        <div className="meter" aria-hidden="true"><i style={{ width: `${(100 * done) / total}%` }} /></div>
      </div>
      <span className="count mono" aria-label={`Question ${done + 1} of ${total}`}>{done + 1}/{total}</span>
    </div>
  );
  const crumbs = (extra?: ReactNode) => (
    <div className="crumbs">
      <span className="mono">{item.kind === "osce" ? item.card.id : itemPlace(item)}</span>
      <span className="chip small">{subjectName(item.card.subject)}</span>
      {extra}
      <ReviewChip cardId={item.card.id} />
    </div>
  );
  const toast = undo && cur.phase !== "logging" && (
    <div className="toast" role="status"><span>{undo.label}</span><button onClick={doUndo}>Undo</button></div>
  );
  const selfMarkBar = (
    <div className="mark-bar" role="group" aria-label="Mark your answer">
      <button className="btn mark wrong" disabled={saving} onClick={() => set({ phase: "logging" })}><span aria-hidden="true">✗</span> Wrong <kbd>W</kbd></button>
      <button className="btn mark right" disabled={saving} onClick={() => mark("right")}><span aria-hidden="true">✓</span> Right <kbd>R</kbd></button>
    </div>
  );
  const errorNote = error && <p className="notice" role="alert">{error}</p>;

  /* ---------- MCQ (tap an option) */
  if (item.kind === "mcq" && item.card.type === "mcq") {
    const c = item.card;
    const answered = cur.chosen !== null;
    const right = mcqRight(c, cur.chosen);
    return (
      <div className="study">
        {head}
        <div className="mcq-view panel">
          {crumbs(<span className="chip small">MCQ</span>)}
          <McqStem card={c} content={content} />
          <McqOptions card={c} chosen={cur.chosen} onChoose={(k) => set({ chosen: k, phase: "revealed" })} disabled={saving} />
          {!answered && <p className="hint">Tap an option, or press {c.options[0].key}–{c.options[c.options.length - 1].key}</p>}
          {answered && <McqFeedback card={c} chosen={cur.chosen!} />}
          {errorNote}
        </div>
        {answered && (c.noKey ? selfMarkBar : (
          <div className="mark-bar" role="group" aria-label="Continue">
            {right
              ? <button className="btn mark right" disabled={saving} onClick={() => mark("right")}>Next <kbd>Enter</kbd></button>
              : <button className="btn mark wrong" disabled={saving} onClick={() => set({ phase: "logging" })}>Log it and go on <kbd>Enter</kbd></button>}
          </div>
        ))}
        {cur.phase === "logging" && (
          <CauseDialog title={itemPlace(item)} saving={saving}
            summary={c.noKey ? undefined : `You chose ${cur.chosen}. Answer: ${c.correct.join(", ")}${c.disputed ? ` (also accepted: ${c.disputed.alt.join(", ")})` : ""}.`}
            onCancel={() => set({ phase: "revealed" })}
            onSave={(v) => mark("wrong", { rootCause: v.rootCause, note: v.note, chosen: cur.chosen ?? undefined })} />
        )}
        {toast}
      </div>
    );
  }

  /* ---------- short-answer MCQ or paper photo (reveal, self-mark, MCQ causes) */
  if (item.kind === "mcq" || item.kind === "photo") {
    const isPhoto = item.kind === "photo";
    return (
      <div className="study">
        {head}
        <div className="mcq-view panel">
          {crumbs(<span className="chip small">{isPhoto ? "Paper photo" : "Short answer"}</span>)}
          {isPhoto
            ? <Pictures ids={(item.card as PhotoCard).images} content={content} alt="Photo of the question" />
            : <McqStem card={item.card as McqCard} content={content} />}
          {cur.phase === "question" ? (
            <>
              <button className="btn primary" onClick={() => set({ phase: "revealed" })}>{isPhoto ? "Reveal the key" : "Reveal answer"}</button>
              <p className="hint">Space to reveal</p>
            </>
          ) : isPhoto ? <PhotoAnswer card={item.card as PhotoCard} /> : (
            <div><p className="label">Answer</p>{((item.card as McqCard).answerText ?? []).map((l, i) => <p key={i} style={{ margin: "0 0 4px" }}>{l}</p>)}</div>
          )}
          {errorNote}
        </div>
        {cur.phase !== "question" && selfMarkBar}
        {cur.phase === "logging" && (
          <CauseDialog title={itemPlace(item)} saving={saving} onCancel={() => set({ phase: "revealed" })}
            onSave={(v) => mark("wrong", { rootCause: v.rootCause, note: v.note })} />
        )}
        {toast}
      </div>
    );
  }

  /* ---------- OSCE picture / station (V1 flow) */
  const card = item.card as Card;
  return (
    <div className="study">
      {head}
      <div className="card-view">
        <Film card={card} content={content} />
        <div className="panel">
          {crumbs(cur.phase !== "question" && card.subject === "radiology" ? <span className="chip small accent">{card.modality}</span> : null)}
          <Question card={card} />
          {cur.phase === "question" && (
            <>
              {settings.typedAnswerBox && (
                <div className="field">
                  <label htmlFor="typed">Your answer <span className="muted">(optional)</span></label>
                  <textarea id="typed" rows={3} value={cur.typed} onChange={(e) => set({ typed: e.target.value })}
                    placeholder={card.subject === "radiology" ? "Modality, findings, diagnosis…" : "Your answer…"}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); set({ phase: "revealed" }); } }} />
                </div>
              )}
              <button className="btn primary" onClick={() => set({ phase: "revealed" })}>Reveal answer</button>
              <p className="hint">Space to reveal{settings.typedAnswerBox ? " · Ctrl+Enter from the answer box" : ""}</p>
            </>
          )}
          {cur.phase !== "question" && (
            <>
              {cur.typed.trim() && (
                <div className="typed"><p className="label">Your answer</p><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{cur.typed.trim()}</p></div>
              )}
              <Answer card={card} />
            </>
          )}
          {errorNote}
        </div>
      </div>
      {cur.phase !== "question" && selfMarkBar}
      {cur.phase === "logging" && (
        <WrongDialog card={card} typedAnswer={cur.typed} saving={saving}
          onCancel={() => set({ phase: "revealed" })}
          onSave={(v) => mark("wrong", { rootCause: v.rootCause, tags: v.tags, note: v.note, typedAnswer: v.typedAnswer })} />
      )}
      {toast}
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
  const wrongItems = wrongIds.map((id) => content.items.get(id)).filter(Boolean) as Item[];
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
      {wrongItems.length > 0 ? (
        <div className="panel">
          <h2>{session.filter.review ? "Back to the start of the cycle" : "Saved to your error log"}</h2>
          <p className="muted" style={{ margin: 0 }}>These come back for review in 48 hours.</p>
          <ul className="wrong-list">
            {wrongItems.map((it) => <li key={it.card.id}><a href={href(`/card/${it.card.id}`)}><span className="mono">{itemPlace(it)}</span> {itemTitle(it)}</a></li>)}
          </ul>
          <button className="btn primary" onClick={retry}>Retry the {wrongItems.length} I got wrong now</button>
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
