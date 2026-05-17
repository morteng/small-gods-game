/* global React, Panel, Chip, Eyebrow, Btn, Badge, Sigil, Meter, Hr, G, Key */
const { useState, useRef, useEffect, useCallback } = React;

// TIME BAR — minimal, friendly. Default: a small chip in the top-right.
// Press T (or click the chip) and the full bar slides up from the bottom.
// When scrubbed away from now, two clear buttons appear: Continue / Try again.

const MAX_TICK = 1840;

const TRACK_EVENTS = [
  { id:135, t: 1620, type: "miracle",  chapter: true,  label: "Rain in the drought" },
  { id:136, t: 1700, type: "rival",                    label: "Rival stirs at the river" },
  { id:137, t: 1740, type: "birth",                    label: "Orin marries" },
  { id:138, t: 1788, type: "whisper",                  label: "Whisper · Kira" },
  { id:139, t: 1814, type: "mood",                     label: "Tam's mood falls" },
  { id:140, t: 1822, type: "realize",  chapter: true,  label: "A new field unfolds" },
  { id:141, t: 1838, type: "beliefRise",               label: "Mira ↑ 0.30" },
  { id:142, t: 1840, type: "whisper",                  label: "Whisper · Mira" },
];

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// The collapsed chip — top-right corner, always visible.
function TimeChip({ rate = 1, year = "Y1 spring · 30/96", onClick }) {
  const paused = rate === 0;
  return (
    <button className="sg-chip" onClick={onClick} title="Time (T)">
      <span style={{ display: "inline-flex", color: paused ? "var(--time)" : "var(--ink-3)" }}>
        {paused ? G.pause : G.clock}
      </span>
      <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{year}</span>
      <span style={{
        fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 600,
        padding: "1px 6px", borderRadius: "var(--r-pill)",
        background: paused ? "var(--time-soft)" : "var(--paper-2)",
        color: paused ? "var(--time)" : "var(--ink-2)",
        border: "1px solid var(--line)",
      }}>{paused ? "paused" : rate + "×"}</span>
    </button>
  );
}

// The full bar — appears on demand.
function TimeBar({ initialTick = MAX_TICK, initialRate = 1, onChange, allowDismiss = true }) {
  const [tick, setTick] = useState(initialTick);
  const [rate, setRate] = useState(initialRate);
  const [hoverT, setHoverT] = useState(null);
  const isScrubbed = tick < MAX_TICK;
  const trackRef = useRef(null);

  useEffect(() => { onChange && onChange({ tick, rate, isScrubbed }); }, [tick, rate, isScrubbed]);

  const tickFromX = useCallback((clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    const f = clamp((clientX - r.left) / r.width, 0, 1);
    return Math.round(f * MAX_TICK);
  }, []);

  const onMouseMove = (e) => setHoverT(tickFromX(e.clientX));
  const onMouseLeave = () => setHoverT(null);

  const dragging = useRef(false);
  const onDown = (e) => { dragging.current = true; setTick(tickFromX(e.clientX)); e.preventDefault(); };
  useEffect(() => {
    const mv = (e) => { if (dragging.current) setTick(tickFromX(e.clientX)); };
    const up = () => { dragging.current = false; };
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  }, [tickFromX]);

  return (
    <Panel floating style={{ padding: 0, width: "100%", overflow: "hidden" }} className="sg-fade-up">
      {/* commit row — only when scrubbed */}
      {isScrubbed && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, padding: "10px 14px",
          background: "var(--time-soft)",
          borderBottom: "1px solid var(--line)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{
              display: "inline-block", width: 6, height: 6, borderRadius: "50%",
              background: "var(--time)", flexShrink: 0,
              animation: "sg-pulse 1.6s ease-in-out infinite",
            }} />
            <span style={{ fontSize: 13, color: "var(--ink)" }}>
              You're looking back to <span className="sg-data" style={{ color: "var(--time)" }}>tick {tick}</span>.
              <span style={{ color: "var(--ink-3)", marginLeft: 6 }}>
                Change what happens next?
              </span>
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Btn ghost onClick={() => setTick(MAX_TICK)} title="Back to the present">
              {G.forwardEnd}<span>Back to now</span>
            </Btn>
            <Btn onClick={() => setTick(MAX_TICK)} title="Resume from here · same chance">
              <span>Continue</span>
            </Btn>
            <Btn tone="danger" onClick={() => setTick(MAX_TICK)} title="Resume from here · new chance">
              {G.reroll}<span>Try a different way</span>
            </Btn>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}>
        {/* transport */}
        <div style={{ display: "flex", gap: 2 }}>
          <Btn ghost icon title="To the beginning" onClick={() => setTick(0)}>{G.rewindEnd}</Btn>
          <Btn ghost icon active={rate === 0} title="Pause / play (Space)" onClick={() => setRate(r => r === 0 ? 1 : 0)}>
            {rate === 0 ? G.play : G.pause}
          </Btn>
          <Btn ghost icon title="To now" onClick={() => setTick(MAX_TICK)}>{G.forwardEnd}</Btn>
        </div>

        {/* track */}
        <div
          ref={trackRef}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          onMouseDown={onDown}
          style={{ position: "relative", flex: 1, height: 32, cursor: "pointer", userSelect: "none" }}
        >
          {/* track line */}
          <div style={{
            position: "absolute", top: "50%", left: 0, right: 0, height: 2,
            background: "var(--line-2)", transform: "translateY(-50%)", borderRadius: 1,
          }} />
          {/* progress */}
          <div style={{
            position: "absolute", top: "50%", left: 0,
            height: 2, transform: "translateY(-50%)",
            width: (tick / MAX_TICK) * 100 + "%",
            background: "var(--time)", borderRadius: 1,
          }} />
          {/* dashed future */}
          {isScrubbed && (
            <div style={{
              position: "absolute", top: "50%", height: 2, transform: "translateY(-50%)",
              left: (tick / MAX_TICK) * 100 + "%", right: 0,
              background: "repeating-linear-gradient(90deg, var(--line-2) 0 4px, transparent 4px 8px)",
            }} />
          )}

          {/* event glyphs */}
          {TRACK_EVENTS.map(e => {
            const left = (e.t / MAX_TICK) * 100 + "%";
            const ahead = e.t > tick && isScrubbed;
            const color =
              e.type === "miracle"    ? "var(--w-sun)" :
              e.type === "rival"      ? "var(--danger)" :
              e.type === "whisper"    ? "var(--you)" :
              e.type === "beliefRise" ? "var(--w-sun)" :
              e.type === "realize"    ? "var(--time)" :
                                        "var(--ink-3)";
            return (
              <div key={e.id} style={{
                position: "absolute", left, top: "50%",
                transform: "translate(-50%, -50%)",
                color: ahead ? "var(--ink-4)" : color,
                background: "var(--paper)",
                border: `1px solid ${ahead ? "var(--line)" : color}`,
                borderRadius: 3,
                width: 18, height: 18,
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: ahead ? 0.55 : 1,
              }} title={`t ${e.t} · ${e.label}`}>
                {G[e.type]}
                {e.chapter && (
                  <span style={{
                    position: "absolute", left: "50%", top: -12, transform: "translateX(-50%)",
                    width: 4, height: 4, borderRadius: "50%",
                    background: "var(--time)",
                  }} />
                )}
              </div>
            );
          })}

          {/* scrub head */}
          <div style={{
            position: "absolute", left: (tick / MAX_TICK) * 100 + "%",
            top: 0, bottom: 0, width: 2, transform: "translateX(-50%)",
            background: isScrubbed ? "var(--time)" : "var(--you)",
          }}>
            <div style={{
              position: "absolute", top: -3, left: "50%", transform: "translateX(-50%)",
              width: 10, height: 10,
              background: isScrubbed ? "var(--time)" : "var(--you)",
              border: "2px solid white",
              borderRadius: "50%",
              boxShadow: "var(--lift-1)",
            }} />
          </div>

          {/* hover tooltip */}
          {hoverT != null && (
            <div style={{
              position: "absolute", left: (hoverT / MAX_TICK) * 100 + "%",
              top: -22, transform: "translateX(-50%)",
              fontFamily: "var(--f-mono)", fontSize: 10,
              color: "var(--ink)", background: "var(--paper)",
              padding: "2px 6px", borderRadius: 3,
              border: "1px solid var(--line-2)",
              whiteSpace: "nowrap", pointerEvents: "none",
              boxShadow: "var(--lift-1)",
            }}>tick {hoverT}</div>
          )}
        </div>

        {/* tick label */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 90 }}>
          <span className="sg-data" style={{ fontSize: 12, color: "var(--ink)" }}>
            <span style={{ color: isScrubbed ? "var(--time)" : "var(--you)", fontWeight: 600 }}>{tick}</span>
            <span style={{ color: "var(--ink-4)" }}> / {MAX_TICK}</span>
          </span>
          <span style={{ fontSize: 10, color: "var(--ink-3)" }}>
            {isScrubbed ? "looking back" : "now"}
          </span>
        </div>

        {/* speed */}
        <div style={{ display: "flex", gap: 2 }}>
          {[1, 2, 4, 8].map(s => (
            <Btn key={s} ghost active={rate === s} title={`speed ${s}× (key ${s})`} onClick={() => setRate(s)}>
              <span style={{ fontFamily: "var(--f-mono)", fontSize: 12 }}>{s}×</span>
            </Btn>
          ))}
        </div>

        {/* dismiss */}
        {allowDismiss && (
          <Btn ghost icon title="Hide time bar (T)">{G.close}</Btn>
        )}
      </div>
    </Panel>
  );
}

window.TimeChip = TimeChip;
window.TimeBar = TimeBar;
window.MAX_TICK = MAX_TICK;
window.TRACK_EVENTS = TRACK_EVENTS;
// Aliases for the old API in case anything still references them
window.TimeBarSafe = TimeBar;
