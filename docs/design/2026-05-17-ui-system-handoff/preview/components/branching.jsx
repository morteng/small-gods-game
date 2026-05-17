/* global React, Panel, Eyebrow, Btn, Badge, Sigil, Meter, Hr, G, Key, IsoWorld */

// Spec C teaser — Branching universes.
// Re-rolled futures stay accessible. The player can peek at them or step in.

function Branching() {
  const branches = [
    { id: "A", name: "Mira the prophet",  age: 1840, believers: 4, tone: "current",   note: "where you are now" },
    { id: "B", name: "The dry winter",    age: 1620, believers: 1, tone: "discarded", note: "you tried differently · 3 ticks ago" },
    { id: "C", name: "Orin's heresy",     age: 1530, believers: 2, tone: "discarded", note: "you tried differently · 12 ticks ago" },
  ];
  return (
    <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <Eyebrow tone="time">spec C · branches</Eyebrow>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 6px", letterSpacing: "-0.01em" }}>
          The lives you almost lived
        </h2>
        <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, maxWidth: 680, margin: 0 }}>
          Every <em>try a different way</em> keeps the version you stepped out of.
          You can come back to look at them, or step inside.
        </p>
      </div>

      <Panel style={{ padding: 22 }}>
        <svg viewBox="0 0 1100 200" width="100%" height="200" style={{ display: "block" }}>
          {/* shared past */}
          <path d="M 60 100 Q 220 100, 360 100" stroke="var(--w-dusk)" strokeWidth="2" fill="none" />
          {[80, 200, 280, 360].map((x, i) => (
            <g key={i}>
              <circle cx={x} cy="100" r="5" fill="white" stroke="var(--w-dusk)" strokeWidth="1.5"/>
              <text x={x} y="86" textAnchor="middle" fontFamily="var(--f-mono)" fontSize="9" fill="var(--ink-3)">
                {["cradle", "first rain", "drought", "rival"][i]}
              </text>
            </g>
          ))}

          {/* A current */}
          <path d="M 360 100 Q 600 92, 1050 70" stroke="var(--you)" strokeWidth="3" fill="none" />
          {[460, 580, 720, 880, 1010].map((x, i) => (
            <circle key={i} cx={x} cy={100 - (x - 360) * 0.043} r="5" fill="var(--you)" />
          ))}
          <text x="1060" y="74" fontFamily="var(--f-sans)" fontSize="13" fontWeight="600" fill="var(--you)">A · here</text>

          {/* B discarded */}
          <path d="M 360 100 Q 540 120, 720 142" stroke="var(--time)" strokeWidth="2" strokeDasharray="3 4" fill="none" opacity="0.7"/>
          {[460, 580, 700].map((x, i) => (
            <circle key={i} cx={x} cy={100 + (x - 360) * 0.12} r="4" fill="var(--time)" opacity="0.7"/>
          ))}
          <g transform="translate(720 142)">
            <circle r="6" fill="white" stroke="var(--danger)" strokeWidth="1.3"/>
            <line x1="-3" y1="-3" x2="3" y2="3" stroke="var(--danger)" strokeWidth="1.3"/>
            <line x1="-3" y1="3"  x2="3" y2="-3" stroke="var(--danger)" strokeWidth="1.3"/>
          </g>
          <text x="735" y="146" fontFamily="var(--f-sans)" fontSize="12" fontWeight="600" fill="var(--time)">B</text>

          {/* C older */}
          <path d="M 280 100 Q 460 154, 660 180" stroke="var(--time)" strokeWidth="2" strokeDasharray="3 4" fill="none" opacity="0.5"/>
          <g transform="translate(660 180)">
            <circle r="6" fill="white" stroke="var(--danger)" strokeWidth="1.3" opacity="0.7"/>
            <line x1="-3" y1="-3" x2="3" y2="3" stroke="var(--danger)" strokeWidth="1.3" opacity="0.7"/>
            <line x1="-3" y1="3"  x2="3" y2="-3" stroke="var(--danger)" strokeWidth="1.3" opacity="0.7"/>
          </g>
          <text x="675" y="184" fontFamily="var(--f-sans)" fontSize="11" fontWeight="600" fill="var(--time)" opacity="0.7">C</text>
        </svg>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 14 }}>
          {branches.map(b => <BranchCard key={b.id} b={b} />)}
        </div>
      </Panel>
    </div>
  );
}

function BranchCard({ b }) {
  const isCurrent = b.tone === "current";
  return (
    <div style={{
      padding: 12,
      background: isCurrent ? "var(--you-soft)" : "var(--paper-2)",
      border: `1px solid ${isCurrent ? "var(--you-line)" : "var(--line)"}`,
      borderRadius: "var(--r-3)",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Sigil glyph={b.id} tone={isCurrent ? undefined : "time"} />
        <div style={{ flex: 1, lineHeight: 1.2 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{b.name}</div>
          <div className="sg-data" style={{ fontSize: 11, color: "var(--ink-3)" }}>
            up to t {b.age} · {b.believers} believer{b.believers === 1 ? "" : "s"}
          </div>
        </div>
        {isCurrent ? <Badge tone="you">here</Badge> : <Badge tone="time">peek</Badge>}
      </div>
      <div style={{ height: 64, borderRadius: 4, overflow: "hidden", border: "1px solid var(--line)", position: "relative" }}>
        <IsoWorld width={320} height={64} label="" />
        {!isCurrent && <div className="sg-past-veil" />}
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{b.note}</div>
      <div style={{ display: "flex", gap: 6 }}>
        {isCurrent
          ? <Btn ghost style={{ flex: 1, justifyContent: "center" }}>{G.book}Read this one</Btn>
          : (
            <>
              <Btn ghost style={{ flex: 1, justifyContent: "center" }}>{G.eye}Peek</Btn>
              <Btn tone="time" style={{ flex: 1, justifyContent: "center" }}>Step in</Btn>
            </>
          )}
      </div>
    </div>
  );
}

window.Branching = Branching;
