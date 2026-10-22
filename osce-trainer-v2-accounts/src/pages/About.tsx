const SOURCES: { title: string; by: string }[] = [
  { title: "MASTERPIECE – OSCE RADIOLOGY (UPDATED)", by: "Zeinab Mohammed, Oliver Boakye Danquah, Elorm Claudius Wemegah, Robert Naakpi Maasoofoa and Agotwin Abugri Barnabas. 30 Roads to Akorli Kingdom originally made by Dr. (Med) Akum Faustin (Class of 2023)." },
  { title: "MASTERPIECE – RADIOLOGY MCQs (UPDATED 2025)", by: "Godfred Adjei Essel, Robert Naakpi Maasoofoa, Agotwin Abugri Barnabas, Oliver Boakye Dankwah and Elorm Claudius Wemegah." },
  { title: "MASTERPIECE – OSCE ANAESTHESIA (UPDATED)", by: "Abdul-Rahim Nindini Ibrahim, Robert Naakpi Maasoofoa, Oliver Boakye Danquah, Anna Asam Akurugu and Davis Aboagye." },
  { title: "MASTERPIECE – ANAESTHESIA MCQs", by: "Abdul-Rahim Nindini Ibrahim, Elorm Claudius Wemegah, Rasheed Zakaria, Brian Naah and Robert Naakpi Maasoofoa." },
  { title: "MASTERPIECE – OSCE OPHTHALMOLOGY (UPDATED)", by: "Originally made by Servant of the Most Living One; updated by PBL 2026 contributors." },
  { title: "MASTERPIECE – OPHTHALMOLOGY MCQs", by: "Elorm Claudius Wemegah, Apraku Oppong Vincent, Robert Naakpi Maasoofoa, Fortune Akuure Tenga and Brian Naah." },
  { title: "MASTERPIECE – OSCE ENT (UPDATED)", by: "Elton-Jones Tetteh and Anane-Agyei Boateng Augustine." },
  { title: "MASTERPIECE – ENT MCQs", by: "Patience Sekyere, Elorm Claudius Wemegah, Robert Naakpi Maasoofoa, Apraku Oppong Vincent and Godwin Kanfrah." },
];

export function AboutPage({ source: _source }: { source: string }) {
  return (
    <div className="section-gap" style={{ maxWidth: 720 }}>
      <h1>About</h1>
      <section className="panel">
        <h2>Sources</h2>
        <p style={{ margin: 0 }}>Questions, images and answers come from the Masterpiece series by HUMBLE_PHD and Kpanjen MD (PBL 2026).</p>
        <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
          {SOURCES.map((s) => <li key={s.title} style={{ marginBottom: 6 }}><i>{s.title}</i><br /><span className="muted">{s.by}</span></li>)}
        </ul>
      </section>
      <section className="panel">
        <h2>How the questions were prepared</h2>
        <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
          <li>Questions that appeared in several papers are stored once and list every paper they appeared in.</li>
          <li>MCQ answers come from the highlighted option in the typed papers, or from each paper's answer key for photographed papers. Photographed papers were typed out by hand and checked against the photos.</li>
          <li>When papers disagree on an answer, the question is marked <b>disputed</b> and either answer counts as right. When the source gives no answer, the app says so and lets you mark yourself.</li>
          <li>Questions shown only inside a photo or projector slide were typed out; photos showing the answer were cropped so it stays hidden until you reveal it.</li>
          <li>Photographed questions that could not be read reliably are kept as <b>paper photos</b>, and handwritten pages as revision notes.</li>
        </ul>
      </section>
      <p className="muted" style={{ margin: 0, fontSize: ".875rem" }}>For revision only. Always confirm answers with your lecturers and standard texts.</p>
    </div>
  );
}
