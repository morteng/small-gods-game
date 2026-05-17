/* global React, Panel, Chip, Eyebrow, Btn, Badge, Sigil, Meter, Hr, G, Key */

// EVENT LOG — collapsed-by-default chip with a "new" indicator.
// Expanded form is a small panel of recent narrated events. Click any row to
// scrub the time bar to that point.

const TICKER_EVENTS = [
  { id: 142, t: 1840, type: "whisper",     prose: <><b>You</b> whisper to <b>Mira</b>.</>, color: "you" },
  { id: 141, t: 1838, type: "beliefRise",  prose: <><b>Mira</b>'s faith passes <span className="sg-data">0.30</span>.</>, color: "faith" },
  { id: 140, t: 1822, type: "realize",     prose: <>A new field unfolds at the river's bend.</>, color: "time" },
  { id: 139, t: 1814, type: "mood",        prose: <><b>Tam</b>'s mood falls.</>, color: "ink-3" },
  { id: 138, t: 1788, type: "whisper",     prose: <><b>You</b> whisper to <b>Kira</b>.</>, color: "you" },
  { id: 137, t: 1740, type: "birth",       prose: <><b>Orin</b> takes a wife.</>, color: "life" },
  { id: 136, t: 1700, type: "rival",       prose: <><i>Something</i> stirs by the river.</>, color: "danger" },
  { id: 135, t: 1620, type: "miracle",     prose: <><b>You</b> brought rain. <b>Mira</b> witnessed.</>, color: "faith", chapter: true },
];

function EventChip({ newCount = 3, onClick }) {
  return (
    <button className="sg-chip" onClick={onClick} title="Recent events (L)">
      <span style={{ display: "inline-flex", color: "var(--ink-3)" }}>{G.book}</span>
      <span style={{ fontSize: 12, color: "var(--ink-2)" }}>recent</span>
      {newCount > 0 && (
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          minWidth: 18, height: 18, padding: "0 5px",
          background: "var(--you)", color: "white",
          borderRadius: "var(--r-pill)", fontSize: 10, fontWeight: 700,
          fontFamily: "var(--f-mono)",
        }}>+{newCount}</span>
      )}
    </button>
  );
}

function EventPanel({ heightLimit = 360, width = 320 }) {
  return (
    <Panel floating style={{ width, display: "flex", flexDirection: "column", overflow: "hidden" }} className="sg-fade-up">
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 12px", borderBottom: "1px solid var(--line)",
      }}>
        <Eyebrow>recent · 142 in the log</Eyebrow>
        <div style={{ display: "flex", gap: 4 }}>
          <Btn ghost icon title="open the Book">{G.book}</Btn>
          <Btn ghost icon title="close">{G.close}</Btn>
        </div>
      </div>
      <div className="sg-scroll" style={{
        maxHeight: heightLimit, overflowY: "auto", padding: "4px 0",
      }}>
        {TICKER_EVENTS.map(e => <TickerRow key={e.id} e={e} />)}
      </div>
    </Panel>
  );
}

function TickerRow({ e }) {
  const c =
    e.color === "you"   ? "var(--you)" :
    e.color === "faith" ? "var(--w-sun)" :
    e.color === "time"  ? "var(--time)" :
    e.color === "danger"? "var(--danger)" :
    e.color === "life"  ? "var(--w-leaf)" :
                          "var(--ink-3)";
  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "44px 20px 1fr",
        gap: 8, padding: "7px 12px",
        cursor: "pointer", position: "relative",
        alignItems: "center",
      }}
      onMouseEnter={(ev) => ev.currentTarget.style.background = "var(--paper-2)"}
      onMouseLeave={(ev) => ev.currentTarget.style.background = "transparent"}
    >
      {e.chapter && <span style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
        background: "var(--time)", opacity: 0.7,
      }} />}
      <span className="sg-data" style={{ fontSize: 10, color: "var(--ink-4)", textAlign: "right" }}>t {e.t}</span>
      <span style={{ color: c, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{G[e.type]}</span>
      <div style={{ fontSize: 12.5, color: "var(--ink)", lineHeight: 1.45 }}>{e.prose}</div>
    </div>
  );
}

window.EventChip = EventChip;
window.EventPanel = EventPanel;
window.TICKER_EVENTS = TICKER_EVENTS;
