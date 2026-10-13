import { useState } from "react";
import { answerLines, imageUrl } from "../data/content.ts";
import type { Card, Content } from "../data/types.ts";
import { ImageViewer } from "./ImageViewer.tsx";

/** The image(s) of a card on a black "film" background; tap opens the full-screen viewer. */
export function Film({ card, content }: { card: Card; content: Content }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!card.images.length) return <div className="film"><p className="caption">Text-only question</p></div>;
  return (
    <>
      <div className="film">
        {card.images.map((img, k) => (
          <button key={img} onClick={() => setOpen(k)} aria-label={`Enlarge image ${k + 1}`}>
            <img src={imageUrl(img)} alt={card.images.length > 1 ? `Question image ${k + 1} of ${card.images.length}` : "Question image"}
              width={content.images[img].w} height={content.images[img].h} />
          </button>
        ))}
        <p className="caption">Tap the image to zoom</p>
      </div>
      {open !== null && <ImageViewer images={card.images} start={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function Question({ card }: { card: Card }) {
  return (
    <div>
      <p className="label">Question{card.promptSource === "generic" ? " (no question in source)" : ""}</p>
      {card.stem && <p className="stem">{card.stem}</p>}
      <ol className="prompts" style={{ listStyle: card.prompts.some((p) => /^\(?[\da-e][.)]/.test(p)) ? "none" : undefined, paddingLeft: card.prompts.some((p) => /^\(?[\da-e][.)]/.test(p)) ? 0 : undefined }}>
        {card.prompts.map((p, i) => <li key={i}>{p}</li>)}
      </ol>
    </div>
  );
}

function Lines({ lines, prompts }: { lines: string[]; prompts: string[] }) {
  return <div className="answer">{answerLines(lines, prompts).map((l, i) =>
    <p key={i} className={l.kind === "question" ? "q" : l.kind === "answer" ? "a" : undefined}>{l.text || " "}</p>)}</div>;
}

export function Answer({ card }: { card: Card }) {
  return (
    <div className="stack">
      <div>
        <p className="label">Answer</p>
        {card.diagnosis && <p className="dx" style={{ margin: "0 0 8px" }}>{card.diagnosis}</p>}
        {card.noAnswer
          ? <p className="muted">No answer in source.</p>
          : <Lines lines={card.answer} prompts={card.prompts} />}
      </div>
      {card.notes.length > 0 && <div><p className="label">Notes</p>{card.notes.map((n, i) => <p key={i} className="muted" style={{ margin: "0 0 4px" }}>{n}</p>)}</div>}
      {card.altAnswers.length > 0 && (
        <details className="alt">
          <summary>Other versions of this answer ({card.altAnswers.length})</summary>
          {card.altAnswers.map((a, i) => <div key={i}><p className="src">{a.source}</p><Lines lines={a.lines} prompts={card.prompts} /></div>)}
        </details>
      )}
      <p className="seen">Appears in: {card.appearsIn.join(" · ")}</p>
    </div>
  );
}
