/* global React, G */
const { useState: useStateImg } = React;

// IMAGE SLOT — the universal placeholder for any generated image.
// Every painted asset (NPC portrait, area vista, chapter scene, god
// portrait) passes through these six states. Designed so absence is
// honest and latency feels deliberate, not broken.
//
// Props:
//   state:    "empty" | "queued" | "painting" | "ready" | "stale" | "failed"
//   kind:     "portrait" | "vista" | "scene"
//   src:      image url (when state === "ready" or "stale")
//   alt:      accessible name
//   initials: 1–2 letters for the placeholder (e.g. "MI" for Mira)
//   color:    base color for the placeholder background (oklch string)
//   label:    optional bottom-left chip label, e.g. "as Mira sees you"
//   eta:      seconds remaining (for painting state) — numeric
//   queuePos: 1-based position when state === "queued"
//   onRetry:  click handler when state === "failed"

const SIZES = {
  portrait: { width: 96, height: 96, font: 24 },
  vista:    { width: 320, height: 200, font: 28 },
  scene:    { width: 480, height: 270, font: 30 },
};

function ImageSlot({
  state = "empty",
  kind = "portrait",
  src,
  art,
  alt = "",
  initials = "—",
  color = "var(--paper-2)",
  label,
  eta,
  queuePos,
  onRetry,
  style,
  size,
}) {
  const dims = size || SIZES[kind];
  const cls = `sg-img sg-img--${kind} ${state === "stale" ? "sg-img--stale" : ""}`;
  return (
    <div className={cls} style={{ width: dims.width, height: dims.height, ...style }}>
      {/* base placeholder */}
      {state !== "ready" && state !== "stale" && (
        <>
          <div className="sg-img__stripe" />
          <div className="sg-img__init" style={{
            fontSize: dims.font,
            color: `color-mix(in oklch, ${color === "var(--paper-2)" ? "var(--ink-3)" : color} 70%, transparent)`,
          }}>
            {state === "failed" ? (
              <span style={{ fontSize: dims.font * 0.6, color: "var(--ink-3)" }}>—</span>
            ) : initials}
          </div>
        </>
      )}

      {/* ready / stale: show the image */}
      {(state === "ready" || state === "stale") && src && (
        <img className="sg-img__pic" src={src} alt={alt} />
      )}
      {(state === "ready" || state === "stale") && !src && art && (
        <div className="sg-img__pic" style={{ display: "block" }}>{art}</div>
      )}

      {/* painting: sweep */}
      {state === "painting" && <div className="sg-img__sweep" />}

      {/* state-specific corner badges */}
      {state === "queued" && queuePos != null && (
        <span className="sg-img__corner">
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--ink-4)" }} />
          queue · {queuePos}
        </span>
      )}
      {state === "painting" && (
        <span className="sg-img__corner" style={{ color: "var(--time)", borderColor: "var(--time-line)" }}>
          <span style={{
            width: 5, height: 5, borderRadius: "50%",
            background: "var(--time)",
            animation: "sg-pulse 1.2s ease-in-out infinite",
          }} />
          painting{eta != null ? ` · ${eta}s` : ""}
        </span>
      )}
      {state === "stale" && (
        <span className="sg-img__corner" style={{ color: "var(--w-sun)", borderColor: "oklch(0.78 0.13 85 / 0.45)" }}>
          repaint pending
        </span>
      )}
      {state === "failed" && (
        <button
          onClick={onRetry}
          className="sg-img__corner"
          style={{ cursor: "pointer", background: "var(--paper)", color: "var(--danger)", borderColor: "oklch(0.52 0.16 30 / 0.4)" }}
          title="Try painting again"
        >
          ↻ retry
        </button>
      )}

      {/* bottom-left label */}
      {label && (
        <div style={{
          position: "absolute", left: 6, bottom: 6,
          padding: "2px 6px", borderRadius: "var(--r-pill)",
          background: "var(--shade)", border: "1px solid var(--line)",
          fontFamily: "var(--f-mono)", fontSize: 9,
          color: "var(--ink-3)", letterSpacing: "0.04em",
        }}>{label}</div>
      )}
    </div>
  );
}

// Image-queue chip — a small indicator near the corner showing how many
// images are being / waiting to be painted. Hover to expand.
function ImageQueueChip({ painting = 0, queued = 0, onClick }) {
  const active = painting > 0 || queued > 0;
  return (
    <button className="sg-chip" onClick={onClick} title="Painting queue" style={{
      opacity: active ? 1 : 0.7,
    }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 18, height: 18, borderRadius: "50%",
        background: active ? "var(--time-soft)" : "transparent",
        border: `1px solid ${active ? "var(--time-line)" : "var(--line)"}`,
        color: active ? "var(--time)" : "var(--ink-3)",
        fontSize: 11,
      }}>
        {active ? (
          <span style={{
            display: "inline-block", width: 6, height: 6, borderRadius: "50%",
            background: "var(--time)",
            animation: painting > 0 ? "sg-pulse 1.2s ease-in-out infinite" : "none",
          }} />
        ) : "—"}
      </span>
      <span style={{ fontSize: 12, color: active ? "var(--ink-2)" : "var(--ink-3)" }}>
        {active ? `painting · ${painting + queued}` : "no paintings"}
      </span>
    </button>
  );
}

Object.assign(window, { ImageSlot, ImageQueueChip, SIZES });
