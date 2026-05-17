/* global React, Panel, Eyebrow, Btn, Badge, Sigil, Meter, Hr, G, Key */

// Spec E teaser — The Book. Two-page spread, paper-warm. Chapters surface
// from event-log patterns; the title is what believers call this period, and
// the fidelity badge measures drift from what actually happened.

function Book() {
  return (
    <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <Eyebrow tone="time">spec E · the book</Eyebrow>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 6px", letterSpacing: "-0.01em" }}>
          The Book of <span style={{ color: "var(--you)" }}>—</span>
        </h2>
        <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, maxWidth: 720, margin: 0 }}>
          Written from the event log; re-written every time a story mutates.
          The chapter title is what your believers <em>call</em> this period.
          The fidelity badge is how far it has drifted from what actually happened.
        </p>
      </div>

      <Panel style={{ padding: 28, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, position: "relative" }}>
        <div style={{ position: "absolute", left: "50%", top: 24, bottom: 24, width: 1, background: "var(--line)" }} />

        {/* LEFT */}
        <div style={{ paddingRight: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
            <Eyebrow>chapter the third</Eyebrow>
            <span className="sg-data" style={{ fontSize: 10, color: "var(--ink-4)" }}>page 14 — 15</span>
          </div>
          <h3 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px", letterSpacing: "-0.01em" }}>The Rain of Mira</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            <Badge tone="time">fidelity 34%</Badge>
            <Badge>4 generations</Badge>
            <Badge>47 carriers</Badge>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--ink)", textIndent: "1.4em" }}>
            And in the third winter the rain came, and Mira knelt upon the stone, and the village
            knew it had been spared. <span style={{ color: "var(--ink-3)" }}>Some say she climbed the mountain.</span>
            Some say she wrestled the storm for three nights. The grain has remembered her.
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.65, color: "var(--ink-2)", textIndent: "1.4em" }}>
            <span style={{ color: "var(--time)" }}>—</span> heard at Tam's hearth, year 33; recorded at year 47.
          </p>
        </div>

        {/* RIGHT */}
        <div style={{ paddingLeft: 8 }}>
          <Panel alt style={{ padding: 14, marginBottom: 14 }}>
            <Eyebrow tone="time" style={{ marginBottom: 6 }}>what actually happened</Eyebrow>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--ink-2)" }}>
              At tick 1620 you cast a <span style={{ color: "var(--w-sun)", fontWeight: 600 }}>rain</span> miracle.
              Mira was the only witness. The mountain was 3 tiles south of where they say she climbed.
              Tam was elsewhere.
            </p>
          </Panel>

          <div style={{ marginBottom: 14 }}>
            <Eyebrow style={{ marginBottom: 8 }}>the line of telling</Eyebrow>
            <Lineage />
          </div>

          <div>
            <Eyebrow style={{ marginBottom: 8 }}>themes that have stuck</Eyebrow>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              <Badge>rain</Badge>
              <Badge tone="you">sacrifice</Badge>
              <Badge>holy woman</Badge>
              <Badge tone="danger">struggle</Badge>
              <Badge>grain</Badge>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Lineage() {
  const nodes = [
    { gen: "G1", name: "Mira",    fid: 0.98 },
    { gen: "G2", name: "Kira",    fid: 0.71 },
    { gen: "G3", name: "Tam",     fid: 0.45 },
    { gen: "G4", name: "village", fid: 0.34 },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {nodes.map((n, i) => (
        <React.Fragment key={n.gen}>
          <div style={{
            padding: 8, minWidth: 60, textAlign: "center",
            background: "var(--paper)", border: "1px solid var(--line-2)", borderRadius: 6,
          }}>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--ink-4)" }}>{n.gen}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{n.name}</div>
            <div className="sg-data" style={{ fontSize: 10, color: n.fid > 0.6 ? "var(--w-sun)" : "var(--time)" }}>{Math.round(n.fid * 100)}%</div>
          </div>
          {i < nodes.length - 1 && (
            <svg width="18" height="18" viewBox="0 0 20 20">
              <path d="M 2 10 L 16 10 M 12 6 L 16 10 L 12 14" stroke="var(--line-2)" strokeWidth="1.4" fill="none" />
            </svg>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

window.Book = Book;
