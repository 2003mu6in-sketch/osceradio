import { useState } from "react";
import { imageUrl } from "../data/content.ts";
import type { Content, McqCard, PhotoCard } from "../data/types.ts";
import { ImageViewer } from "./ImageViewer.tsx";

/** Pictures attached to an MCQ or paper photo (e.g. an ECG strip). Tap to zoom. */
export function Pictures({ ids, content, alt }: { ids: string[]; content: Content; alt: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!ids.length) return null;
  return (
    <>
      <div className="mcq-figs">
        {ids.map((img, k) => (
          <button key={img} onClick={() => setOpen(k)} aria-label={`Enlarge picture ${k + 1}`}>
            <img src={imageUrl(img)} alt={ids.length > 1 ? `${alt} ${k + 1} of ${ids.length}` : alt}
              width={content.images[img]?.w} height={content.images[img]?.h} />
          </button>
        ))}
      </div>
      {open !== null && <ImageViewer images={ids} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function McqStem({ card, content }: { card: McqCard; content: Content }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      {card.leadIn && <p className="lead-in">{card.leadIn}</p>}
      <Pictures ids={card.images} content={content} alt="Question picture" />
      <p className="stem mcq-stem">{card.stem}</p>
    </div>
  );
}

export type OptionState = "idle" | "chosen-right" | "chosen-wrong" | "correct" | "also" | "dim";

/** Option list. Before answering, every option is a button; afterwards they show the result. */
export function McqOptions({ card, chosen, onChoose, disabled, reference }: {
  card: McqCard; chosen: string | null; onChoose: (k: string) => void; disabled?: boolean; reference?: boolean;
}) {
  const answered = chosen !== null;
  const stateOf = (k: string): OptionState => {
    if (!answered) return "idle";
    if (reference) return card.correct.includes(k) ? "correct" : card.accepted.includes(k) ? "also" : "dim";
    if (card.noKey) return k === chosen ? "chosen-right" : "dim";
    const ok = card.accepted.includes(k);
    if (k === chosen) return ok ? "chosen-right" : "chosen-wrong";
    if (card.correct.includes(k)) return "correct";
    if (ok) return "also";
    return "dim";
  };
  return (
    <ol className="mcq-options" aria-label="Options">
      {card.options.map((o, i) => {
        const st = stateOf(o.key);
        const mark = st === "chosen-right" ? (card.noKey ? "Your choice" : "✓ Right")
          : st === "chosen-wrong" ? "✗ Your answer" : st === "correct" ? "✓ Answer" : st === "also" ? "~ Also accepted" : "";
        return (
          <li key={o.key}>
            <button type="button" className={`mcq-opt ${st}`} disabled={answered || disabled} aria-pressed={o.key === chosen}
              onClick={() => onChoose(o.key)}>
              <kbd>{o.key}</kbd>
              <span className="txt">{o.text}</span>
              {mark && <span className="res">{mark}</span>}
              {!answered && i < 9 && <span className="sr-only">Press {o.key} or {i + 1}</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Explanation shown after answering: key, disputes, notes, where it appeared. */
export function McqFeedback({ card, chosen, reference }: { card: McqCard; chosen: string; reference?: boolean }) {
  const right = card.accepted.includes(chosen);
  const keyText = card.options.filter((o) => card.correct.includes(o.key)).map((o) => `${o.key}. ${o.text}`);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {reference ? (
        card.noKey ? <p className="verdict neutral"><b>No answer in the source.</b></p>
          : <p className="verdict neutral"><b>{card.multiMarked ? "Answers:" : "Answer:"}</b> {keyText.join(" · ")}</p>
      ) : card.noKey ? (
        <p className="verdict neutral" role="status"><b>No answer in the source.</b> Check it in your notes, then mark yourself.</p>
      ) : (
        <p className={`verdict ${right ? "right" : "wrong"}`} role="status">
          <b>{right ? "Right." : "Not quite."}</b> {card.multiMarked ? "The source marks several answers: " : "Answer: "}{keyText.join(" · ")}
        </p>
      )}
      {card.disputed && (
        <p className="notice">
          {card.disputed.reason === "key-differs"
            ? `Disputed: this question appears in ${card.appearsIn.length} papers and they are marked differently (${card.correct.join(", ")} and ${card.disputed.alt.join(", ")}). Either counts as right here.`
            : `Disputed: the source highlights a second answer (${card.disputed.alt.join(", ")}). Either counts as right here.`}
        </p>
      )}
      {card.notes.length > 0 && <div><p className="label">Notes</p>{card.notes.map((n, i) => <p key={i} className="muted" style={{ margin: "0 0 4px" }}>{n}</p>)}</div>}
      <p className="seen">{card.source === "transcribed" ? "Typed from a photo of the paper · " : ""}Appears in: {card.appearsIn.join(" · ")}</p>
    </div>
  );
}

export function PhotoAnswer({ card }: { card: PhotoCard }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="label">Answer</p>
      {card.answerKey ? <p className="dx" style={{ margin: 0 }}>Key: {card.answerKey}</p> : <p className="muted" style={{ margin: 0 }}>No answer in the source.</p>}
      <p className="muted" style={{ margin: 0 }}>{card.note}</p>
      <p className="seen">PDF page {card.page} · {card.appearsIn.join(" · ")}</p>
    </div>
  );
}
