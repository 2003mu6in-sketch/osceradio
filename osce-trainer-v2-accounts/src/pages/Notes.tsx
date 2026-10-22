import type { Content, Subject } from "../data/types.ts";
import { SUBJECTS, subjectName } from "../data/types.ts";
import { AnswerPictures } from "../ui/CardParts.tsx";

/** Revision notes and handwritten pages for one subject (read only, not quizzed). */
export function NotesPage({ content, subject }: { content: Content; subject: string }) {
  const s = (SUBJECTS.some((x) => x.id === subject) ? subject : "radiology") as Subject;
  const notes = content.notes.filter((n) => n.subject === s);
  return (
    <div className="section-gap" style={{ maxWidth: 820 }}>
      <div>
        <p className="eyebrow">{subjectName(s)}</p>
        <h1>Revision notes</h1>
        <p className="lede">Station lists, tips and handwritten case notes from the PDF. They are for reading; they are not part of Study or Review.</p>
      </div>
      {notes.length === 0 && <div className="empty"><h2>No revision notes for {subjectName(s)}</h2><a className="btn" href="#/">Back to Study</a></div>}
      {notes.map((n) => (
        <section key={n.id} className="panel" id={n.id}>
          <h2>{n.title.replace(`${subjectName(s)} `, "")}{n.handwritten && <span className="chip small" style={{ marginLeft: 8 }}>Handwritten</span>}</h2>
          {n.lines.length > 0 && <div className="note-lines">{n.lines.map((l, i) => <p key={i}>{l}</p>)}</div>}
          {n.images.length > 0 && <AnswerPictures ids={n.images} label={n.handwritten ? `${n.images.length} pages – tap to read` : "Pictures"} />}
        </section>
      ))}
    </div>
  );
}
