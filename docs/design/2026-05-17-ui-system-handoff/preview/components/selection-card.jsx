/* global React, Panel, Eyebrow, Btn, Badge, Sigil, Meter, Hr, G, Key */

// SELECTION — two affordances:
//   1) Callout: a small floating tag near the NPC with name + 1 action.
//   2) Card: a larger panel that slides in from the right edge if the user
//      wants to dig deeper (clicks "More" or holds the mouse on the NPC).
// Most of the time, only the callout shows.

function SelectionCallout() {
  return (
    <div style={{ position: "relative", display: "inline-block" }} className="sg-fade-up">
      {/* leader line + ring */}
      <svg width="60" height="60" style={{ position: "absolute", left: -50, top: 28, pointerEvents: "none" }}>
        <circle cx="50" cy="20" r="12" fill="none" stroke="var(--you)" strokeWidth="1.4" strokeDasharray="2 3" />
        <path d="M 38 16 L 28 8" stroke="var(--you)" strokeWidth="1.2" fill="none" />
      </svg>
      <Panel floating style={{
        padding: 8, display: "flex", alignItems: "center", gap: 8,
        minWidth: 200,
      }}>
        <Sigil glyph="m" />
        <div style={{ flex: 1, lineHeight: 1.2 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Mira</div>
          <div className="sg-data" style={{ fontSize: 10, color: "var(--ink-3)" }}>
            faith <span style={{ color: "var(--w-sun)" }}>0.34</span> · farmer · 34
          </div>
        </div>
        <Btn primary style={{ padding: "4px 10px" }}>{G.whisper}<span>Whisper</span><Key>W</Key></Btn>
        <button className="sg-btn sg-btn--ghost sg-btn--icon" title="More">{G.chevDown}</button>
      </Panel>
    </div>
  );
}

function SelectionCard({ portraitState = "ready" }) {
  return (
    <Panel floating style={{ width: 320, padding: 14, display: "flex", flexDirection: "column", gap: 12 }} className="sg-fade-up">
      {/* identity */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <ImageSlot
          state={portraitState}
          kind="portrait"
          size={{ width: 64, height: 64, font: 22 }}
          initials="Mi"
          art={portraitState === "ready" || portraitState === "stale" ? <StubPortraitArt seed={2} hueShift={20} /> : null}
          alt="Mira's portrait"
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>Mira</span>
            <Badge tone="you">believer</Badge>
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>farmer · age 34 · the cradle field</div>
          {portraitState === "stale" && (
            <div style={{ fontSize: 10, color: "var(--w-sun)", fontStyle: "italic", marginTop: 4 }}>
              the years have changed her — a new likeness is being painted
            </div>
          )}
        </div>
        <button className="sg-btn sg-btn--ghost sg-btn--icon" title="close">{G.close}</button>
      </div>

      {/* belief */}
      <div>
        <Eyebrow style={{ marginBottom: 6 }}>belief in you</Eyebrow>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Meter value={0.34} tone="faith" pips={[0.3, 0.6, 0.9]} style={{ flex: 1 }} />
          <span className="sg-data" style={{ fontSize: 12, color: "var(--ink)" }}>0.34</span>
          <Badge>habit</Badge>
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "8px 0 0", lineHeight: 1.45 }}>
          She felt warmth at the river yesterday. She doesn't know why.
        </p>
      </div>

      <Hr />

      {/* mood + needs (compact) */}
      <div>
        <Eyebrow style={{ marginBottom: 6 }}>state</Eyebrow>
        <Need label="mood"       value={0.61} />
        <Need label="safety"     value={0.72} />
        <Need label="prosperity" value={0.40} />
        <Need label="community"  value={0.55} />
        <Need label="meaning"    value={0.38} highlight />
      </div>

      {/* personality chips (compact) */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        <Badge>pious</Badge>
        <Badge>storyteller</Badge>
        <Badge>curious</Badge>
        <Badge>skeptical ↓</Badge>
      </div>

      <Hr />

      {/* recent in her life */}
      <div>
        <Eyebrow style={{ marginBottom: 6 }}>4 moments touched her</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Moment t="1840" icon={G.whisper}    color="you"   text="you whispered" />
          <Moment t="1788" icon={G.beliefRise} color="faith" text="faith past 0.30" />
          <Moment t="1620" icon={G.miracle}    color="faith" text="rain in the drought" />
          <Moment t="1612" icon={G.realize}    color="time"  text="this field came to be" />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <Btn primary>{G.whisper}<span>Whisper</span><Key>W</Key></Btn>
        <Btn>{G.beliefRise}<span>Bless</span></Btn>
      </div>
      <Btn ghost style={{ justifyContent: "center" }}>{G.book}<span>Her stories</span></Btn>
    </Panel>
  );
}

function Need({ label, value, highlight }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 28px", gap: 8, alignItems: "center", padding: "2px 0" }}>
      <span style={{ fontSize: 11, color: highlight ? "var(--w-sun)" : "var(--ink-3)" }}>{label}</span>
      <Meter value={value} tone={highlight ? "faith" : undefined} />
      <span className="sg-data" style={{ fontSize: 11, color: highlight ? "var(--w-sun)" : "var(--ink-3)", textAlign: "right" }}>{value.toFixed(2)}</span>
    </div>
  );
}

function Moment({ t, icon, color, text }) {
  const c = color === "you" ? "var(--you)" : color === "faith" ? "var(--w-sun)" : color === "time" ? "var(--time)" : "var(--ink-3)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="sg-data" style={{ width: 32, fontSize: 10, color: "var(--ink-4)", textAlign: "right" }}>{t}</span>
      <span style={{ color: c, display: "inline-flex" }}>{icon}</span>
      <span style={{ fontSize: 12, color: "var(--ink-2)", flex: 1 }}>{text}</span>
    </div>
  );
}

window.SelectionCallout = SelectionCallout;
window.SelectionCard = SelectionCard;
