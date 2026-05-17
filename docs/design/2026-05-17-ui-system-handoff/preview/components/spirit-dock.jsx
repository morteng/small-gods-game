/* global React, Panel, Chip, Eyebrow, Btn, Badge, Sigil, Meter, Hr, G, Key */
const { useState: useStateD } = React;

// SPIRIT DOCK — minimal by default. A single chip in the top-left.
// When tapped (or hovered), it expands into a small panel with abilities.
// We render both states here for the design canvas.

function SpiritChip({ open = false, onClick }) {
  return (
    <button className="sg-chip" onClick={onClick} title="Your spirit (click for abilities)">
      <Sigil glyph="ƒ" />
      <span className="sg-data" style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
        67
      </span>
      <span style={{ width: 1, height: 12, background: "var(--line)" }} />
      <span style={{ fontSize: 12, color: "var(--ink-3)" }}>4 believers</span>
      <span style={{ color: "var(--ink-4)", display: "inline-flex" }}>{open ? G.chevUp : G.chevDown}</span>
    </button>
  );
}

function SpiritPanel({ width = 280, imgState = "ready" }) {
  return (
    <Panel floating style={{ width, padding: 14, display: "flex", flexDirection: "column", gap: 12 }} className="sg-fade-up">
      {/* identity */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ImageSlot
          state={imgState}
          kind="portrait"
          size={{ width: 52, height: 52, font: 18 }}
          initials="ƒ"
          art={imgState === "ready" || imgState === "stale" ? <StubPortraitArt seed={1} hueShift={0} accessory="halo" /> : null}
          alt="god portrait"
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>A spirit, unnamed</div>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>Stirring · regen +0.04/s</div>
          <div style={{ fontSize: 10, color: "var(--ink-4)", fontStyle: "italic", marginTop: 2 }}>
            as Mira sees you
          </div>
        </div>
      </div>

      {/* power */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>power</span>
          <span className="sg-data" style={{ fontSize: 12, fontWeight: 600, color: "var(--you)" }}>
            67<span style={{ color: "var(--ink-4)" }}> / 100</span>
          </span>
        </div>
        <Meter value={0.67} pips={[0.30, 0.55, 0.85]} />
      </div>

      {/* believers / stories / realm */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, paddingTop: 4 }}>
        <Stat label="believers" value="4" tone="you" />
        <Stat label="stories"   value="1" />
        <Stat label="realm"     value="142" />
      </div>

      <Hr />

      {/* abilities */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Ability icon={G.whisper}    name="Whisper" hint="W" cost="0–1" />
        <Ability icon={G.miracle}    name="Make rain" hint="R" cost="15" />
        <Ability icon={G.beliefRise} name="Bless"     hint="B" cost="5–10" />
        <Ability icon={G.miracle}    name="Heal"      hint="H" cost="10" />
        <Ability icon={G.rival}      name="Manifest"  cost="50" detail="needs Rising" locked />
      </div>
    </Panel>
  );
}

function Stat({ label, value, tone }) {
  const c = tone === "you" ? "var(--you)" : "var(--ink)";
  return (
    <div style={{
      padding: "6px 8px", textAlign: "center",
      background: "var(--paper-2)", border: "1px solid var(--line)", borderRadius: "var(--r-2)",
    }}>
      <div style={{ fontFamily: "var(--f-mono)", fontWeight: 600, fontSize: 14, color: c }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.04em" }}>{label}</div>
    </div>
  );
}

function Ability({ icon, name, hint, cost, detail, locked }) {
  return (
    <button className="sg-btn sg-btn--ghost" style={{
      justifyContent: "flex-start", padding: "6px 8px",
      opacity: locked ? 0.55 : 1,
      cursor: locked ? "not-allowed" : "pointer",
    }}>
      <span style={{ width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", color: locked ? "var(--ink-4)" : "var(--you)" }}>
        {icon}
      </span>
      <span style={{ flex: 1, textAlign: "left", fontSize: 13 }}>
        {name}
        {detail && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--ink-4)" }}>{detail}</span>}
      </span>
      {!locked && <span className="sg-data" style={{ fontSize: 11, color: "var(--ink-3)" }}>{cost}</span>}
      {hint && !locked && <Key>{hint}</Key>}
    </button>
  );
}

// Combined dock that shows chip + (optionally) the panel below it.
function SpiritDock({ open = true, compact = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
      <SpiritChip open={open} />
      {open && !compact && <SpiritPanel />}
    </div>
  );
}

Object.assign(window, { SpiritChip, SpiritPanel, SpiritDock });
