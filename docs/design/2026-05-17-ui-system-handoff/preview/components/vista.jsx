/* global React, Panel, Chip, Eyebrow, Btn, Badge, Sigil, Meter, Hr, G, Key,
   ImageSlot, IsoWorld */

// VISTA — the "look closer" surface.
// Triggered when the player double-clicks a tile, or selects an area on the
// minimap. The world canvas keeps showing the iso 2D view; the Vista panel
// floats over it with a higher-res painted view (rd-plus, 384px) of what's
// there. While the painting is in flight, we show a stub composed from the
// world's own tiles so the player has something to look at immediately.

function Vista({
  imgState = "ready",
  src,
  art,
  title = "the cradle field",
  subtitle = "south of the river bend",
  onClose,
  width = 480,
}) {
  return (
    <Panel floating style={{ width, padding: 0, overflow: "hidden" }} className="sg-fade-up">
      {/* header */}
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: "1px solid var(--line)",
        gap: 12,
      }}>
        <div>
          <Eyebrow tone="time" style={{ marginBottom: 2 }}>look closer</Eyebrow>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{subtitle}</div>
        </div>
        <button className="sg-btn sg-btn--ghost sg-btn--icon" onClick={onClose} title="close">{G.close}</button>
      </div>

      {/* image */}
      <div style={{ padding: 14, paddingBottom: 10 }}>
        <ImageSlot
          state={imgState}
          kind="vista"
          src={src}
          art={art}
          alt={title}
          initials="◇"
          label="rd-plus · 384"
          eta={12}
          queuePos={2}
          size={{ width: width - 28, height: (width - 28) * 0.625, font: 28 }}
        />
      </div>

      {/* in-world notes */}
      <div style={{ padding: "0 14px 14px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
          <Badge tone="life">grass · 12 ▢</Badge>
          <Badge>3 cottages</Badge>
          <Badge tone="time">river · 4 ▢</Badge>
          <Badge tone="you">4 believers</Badge>
        </div>
        <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)", margin: 0 }}>
          The stone where Mira knelt is still here, three steps off the road. The
          neighbours leave loose grain on it now and pretend they don't.
        </p>
      </div>

      <div style={{ display: "flex", gap: 6, padding: "10px 14px", borderTop: "1px solid var(--line)", background: "var(--paper-2)" }}>
        <Btn ghost>{G.book}<span>Stories from here</span></Btn>
        <div style={{ flex: 1 }} />
        <Btn ghost>{G.eye}<span>Hold the view</span></Btn>
      </div>
    </Panel>
  );
}

// Painted-style stand-in art used when src is not available.
// Renders a soft warm scene that *suggests* an iso painting without
// pretending to be one. Used in the design canvas's "ready" demos.
function StubPortraitArt({ seed = 0, hueShift = 0, accessory }) {
  const hue = 60 + hueShift;
  return (
    <svg viewBox="0 0 96 96" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id={`bg${seed}`} cx="40%" cy="35%" r="80%">
          <stop offset="0%" stopColor={`oklch(0.86 0.10 ${hue + 20})`} />
          <stop offset="100%" stopColor={`oklch(0.55 0.10 ${hue})`} />
        </radialGradient>
        <linearGradient id={`face${seed}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={`oklch(0.82 0.06 ${50 + hueShift / 2})`} />
          <stop offset="100%" stopColor={`oklch(0.62 0.07 ${45 + hueShift / 2})`} />
        </linearGradient>
      </defs>
      <rect width="96" height="96" fill={`url(#bg${seed})`} />
      {/* shoulders */}
      <path d="M 18 96 Q 30 70 48 70 Q 66 70 78 96 Z" fill={`oklch(0.45 0.06 ${50 + hueShift / 2})`} />
      {/* face */}
      <ellipse cx="48" cy="46" rx="18" ry="22" fill={`url(#face${seed})`} />
      {/* hair */}
      <path d="M 30 38 Q 30 24 48 22 Q 66 24 66 38 Q 60 28 48 28 Q 36 28 30 38 Z" fill={`oklch(0.30 0.04 ${30 + hueShift})`} />
      {/* eye hints */}
      <circle cx="41" cy="46" r="1" fill="oklch(0.20 0.02 30)" />
      <circle cx="55" cy="46" r="1" fill="oklch(0.20 0.02 30)" />
      {/* accessory */}
      {accessory === "halo" && (
        <ellipse cx="48" cy="22" rx="20" ry="3" fill="none" stroke="oklch(0.85 0.13 85)" strokeWidth="1" opacity="0.8" />
      )}
      {/* light vignette */}
      <radialGradient id={`vg${seed}`} cx="50%" cy="50%" r="60%">
        <stop offset="60%" stopColor="oklch(0 0 0 / 0)" />
        <stop offset="100%" stopColor="oklch(0 0 0 / 0.35)" />
      </radialGradient>
      <rect width="96" height="96" fill={`url(#vg${seed})`} />
    </svg>
  );
}

function StubVistaArt({ seed = 0 }) {
  // Reuse the iso world stub but with warmer, richer palette to suggest "painted"
  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <IsoWorld width={800} height={500} />
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(180deg, oklch(0.75 0.10 85 / 0.18) 0%, oklch(0.40 0.08 40 / 0.22) 100%)",
        mixBlendMode: "soft-light",
      }} />
      <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 80px oklch(0 0 0 / 0.35)" }} />
    </div>
  );
}

function StubSceneArt({ seed = 0 }) {
  // Wide cinematic — a vignette suggesting "rain falling on a stone"
  return (
    <svg viewBox="0 0 480 270" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`sky${seed}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.50 0.06 230)" />
          <stop offset="60%" stopColor="oklch(0.72 0.05 220)" />
          <stop offset="100%" stopColor="oklch(0.78 0.06 90)" />
        </linearGradient>
        <radialGradient id={`vg${seed}`} cx="50%" cy="50%" r="65%">
          <stop offset="55%" stopColor="oklch(0 0 0 / 0)" />
          <stop offset="100%" stopColor="oklch(0 0 0 / 0.45)" />
        </radialGradient>
      </defs>
      <rect width="480" height="270" fill={`url(#sky${seed})`} />
      {/* far hills */}
      <path d="M 0 170 Q 120 150 240 165 Q 360 178 480 160 L 480 270 L 0 270 Z" fill="oklch(0.42 0.06 145)" opacity="0.8" />
      <path d="M 0 200 Q 120 180 240 195 Q 360 210 480 190 L 480 270 L 0 270 Z" fill="oklch(0.36 0.07 145)" />
      {/* ground */}
      <rect x="0" y="220" width="480" height="50" fill="oklch(0.55 0.08 100)" />
      {/* the stone */}
      <ellipse cx="240" cy="232" rx="34" ry="8" fill="oklch(0.25 0.02 60)" opacity="0.5" />
      <path d="M 218 232 Q 220 210 240 208 Q 260 210 262 232 Z" fill="oklch(0.55 0.014 70)" stroke="oklch(0.40 0.012 70)" strokeWidth="1" />
      {/* figure kneeling */}
      <path d="M 232 226 Q 234 214 240 212 Q 246 214 248 226 L 246 232 L 234 232 Z" fill="oklch(0.40 0.06 30)" />
      <ellipse cx="240" cy="210" rx="4" ry="5" fill="oklch(0.65 0.06 50)" />
      {/* rain streaks */}
      {Array.from({ length: 90 }).map((_, i) => {
        const x = (i * 37) % 480;
        const y = (i * 53) % 230;
        return <line key={i} x1={x} y1={y} x2={x - 4} y2={y + 16} stroke="oklch(0.85 0.05 220)" strokeWidth="0.7" opacity="0.5" />;
      })}
      <rect width="480" height="270" fill={`url(#vg${seed})`} />
    </svg>
  );
}

Object.assign(window, { Vista, StubPortraitArt, StubVistaArt, StubSceneArt });
