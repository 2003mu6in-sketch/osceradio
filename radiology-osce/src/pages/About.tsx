export function AboutPage({ source }: { source: string }) {
  return (
    <div className="section-gap" style={{ maxWidth: 720 }}>
      <h1>About</h1>
      <section className="panel">
        <h2>Source</h2>
        <p style={{ margin: 0 }}>Questions, images and answers come from <i>{source}</i> by HUMBLE_PHD and Kpanjen MD.</p>
        <p className="muted" style={{ margin: 0 }}>Contributors: Zeinab Mohammed, Oliver Boakye Danquah, Elorm Claudius Wemegah, Robert Naakpi Maasoofoa and Agotwin Abugri Barnabas (PBL 2026). 30 Roads to Akorli Kingdom originally made by Dr. (Med) Akum Faustin (Class of 2023).</p>
      </section>
      <section className="panel">
        <h2>How the questions were prepared</h2>
        <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
          <li>Images that appeared in several papers are stored once and list every paper they appeared in.</li>
          <li>Where papers answered the same image differently, the other answers are kept under “Other versions of this answer”.</li>
          <li>Questions shown only inside a photo were typed out; photos showing the answer were cropped so it stays hidden until you reveal it.</li>
          <li>When the source gives no question, the app asks for the modality, findings and diagnosis. When it gives no answer, the app says so.</li>
        </ul>
      </section>
      <p className="muted" style={{ margin: 0, fontSize: ".875rem" }}>For revision only. Always confirm answers with your lecturers and standard texts.</p>
    </div>
  );
}
