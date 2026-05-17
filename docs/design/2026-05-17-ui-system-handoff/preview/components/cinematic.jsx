/* global React, Panel, Eyebrow, Btn, Badge, Sigil, Meter, Hr, G, Key, IsoWorld */

// Spec D teaser — Cinematic. When the event log gathers a beat, the camera
// tightens. The world keeps living underneath; the player just watches.

function Cinematic() {
  return (
    <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <Eyebrow tone="time">spec D · cinematic</Eyebrow>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 6px", letterSpacing: "-0.01em" }}>
          When the world raises a chapter
        </h2>
        <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, maxWidth: 720, margin: 0 }}>
          Letterbox bars drop, chips fade, and one quiet line surfaces. The
          simulation runs on underneath; the spirit just watches.
        </p>
      </div>

      <Panel style={{ padding: 0, position: "relative", overflow: "hidden", height: 460 }}>
        <IsoWorld width={1100} height={460} />

        {/* letterbox */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 56, background: "var(--paper)", borderBottom: "1px solid var(--line)" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 88, background: "var(--paper)", borderTop: "1px solid var(--line)" }} />

        {/* gentle dim */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 56, bottom: 88, background: "oklch(0.55 0.09 225 / 0.04)", pointerEvents: "none" }} />

        {/* top: chapter title */}
        <div style={{
          position: "absolute", left: 0, right: 0, top: 0, height: 56,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 28px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--time)" }} />
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--time)" }}>
              chapter the third · the rain of mira
            </span>
          </div>
          <span className="sg-data" style={{ fontSize: 11, color: "var(--ink-3)" }}>t 1620 · beat 1 of 3</span>
        </div>

        {/* corner framing */}
        <svg width="1100" height="460" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {[
            [40, 56],[1060, 56],[40, 372],[1060, 372]
          ].map(([cx, cy], i) => (
            <g key={i} stroke="var(--you)" strokeWidth="1.4" fill="none">
              <path d={`M ${cx} ${cy} L ${cx + (cx < 550 ? 12 : -12)} ${cy}`}/>
              <path d={`M ${cx} ${cy} L ${cx} ${cy + (cy < 200 ? 12 : -12)}`}/>
            </g>
          ))}
        </svg>

        {/* bottom: prose */}
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: 0, height: 88,
          padding: "10px 28px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6,
        }}>
          <Eyebrow>the world</Eyebrow>
          <p style={{
            margin: 0, fontSize: 17, lineHeight: 1.4, fontStyle: "italic", color: "var(--ink)",
          }}>
            Mira knelt at the stone, and the sky opened. The other women looked up,
            and they did not look at her again the same way.
          </p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="sg-data" style={{ fontSize: 10, color: "var(--ink-4)" }}>
              miracle + witness + village_present
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <Btn ghost>{G.pause}<span>Hold</span></Btn>
              <Btn ghost>skip <Key>S</Key></Btn>
              <Btn primary>Let it play</Btn>
            </div>
          </div>
        </div>
      </Panel>

      <p style={{ fontSize: 12, color: "var(--ink-3)", margin: 0 }}>
        Letterbox treatment + prose voice are shared with the Book; the time bar
        reduces to "skip / let it play" while a cinematic beat is running.
      </p>
    </div>
  );
}

window.Cinematic = Cinematic;
