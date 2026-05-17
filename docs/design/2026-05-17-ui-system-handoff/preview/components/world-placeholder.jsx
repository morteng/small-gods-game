/* global React */

// ISO 2D world placeholder — a stub of classic isometric pixel-art:
// diamond tiles in 2:1 projection, a few "buildings" as 3-face boxes,
// roads, a river, NPC dots. Crude on purpose — it's a placeholder for the
// real LPC-iso art the renderer will produce. It just provides honest
// visual mass for the UI to live against.

function IsoWorld({ width = 800, height = 480, scrubbed = false, label, style }) {
  const TW = 48;          // tile width  (px)
  const TH = TW / 2;      // tile height (2:1 iso)
  const cols = 14, rows = 14;

  // origin offsets so the grid centers in the viewport
  const ox = width  / 2 - (cols * TW) / 2 + TW / 2;
  const oy = height / 2 - (rows * TH) / 2;

  // grid -> screen
  const ts = (gx, gy) => ({
    x: ox + (gx - gy) * (TW / 2),
    y: oy + (gx + gy) * (TH / 2),
  });

  // simple "biome map" — water river, road, grass, sand at edges
  const biome = (gx, gy) => {
    // river: a diagonal band
    const along = gx + gy * 0.6;
    if (Math.abs(along - 14) < 1.4) return "water";
    if (Math.abs(along - 14) < 2.2) return "sand";
    // road: horizontal-ish run
    if (gy === 8 && gx > 4 && gx < 12) return "road";
    if (gx === 6 && gy > 4 && gy < 12) return "road";
    // edge sand
    if (gx === 0 || gx === cols - 1 || gy === 0 || gy === rows - 1) return "grass-d";
    return "grass";
  };

  const fills = {
    grass:   "var(--w-grass)",
    "grass-d": "oklch(0.56 0.10 145)",
    water:   "var(--w-water)",
    sand:    "var(--w-sand)",
    road:    "oklch(0.72 0.05 75)",
  };
  const sides = {
    grass:   "oklch(0.50 0.09 145)",
    "grass-d": "oklch(0.44 0.08 145)",
    water:   "oklch(0.43 0.08 225)",
    sand:    "oklch(0.66 0.05 75)",
    road:    "oklch(0.58 0.04 75)",
  };

  // tiles drawn back-to-front (gy + gx)
  const tiles = [];
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      tiles.push({ gx, gy, b: biome(gx, gy) });
    }
  }
  tiles.sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));

  // buildings: list of {gx, gy, w, h, color, roof}
  const buildings = [
    { gx: 7,  gy: 4, w: 1.6, h: 1.0, c: "var(--w-earth)",            roof: "var(--w-clay)" },
    { gx: 9,  gy: 6, w: 1.0, h: 0.8, c: "oklch(0.40 0.06 50)",       roof: "oklch(0.48 0.16 30)" },
    { gx: 4,  gy: 9, w: 1.2, h: 0.9, c: "var(--w-earth)",            roof: "var(--w-clay)" },
    { gx: 9,  gy: 10, w: 0.9, h: 0.7, c: "oklch(0.40 0.06 50)",      roof: "oklch(0.55 0.10 30)" },
    { gx: 5,  gy: 5,  w: 0.7, h: 0.6, c: "oklch(0.46 0.07 60)",      roof: "oklch(0.50 0.13 30)" },
  ];

  // trees: tiny dark cones on tiles
  const trees = [
    [2, 2], [3, 2], [2, 4], [11, 3], [12, 4], [11, 11], [12, 10], [3, 11], [11, 6],
  ];

  // NPCs (small dots)
  const npcs = [
    { gx: 6.5, gy: 8.0, c: "var(--you)",      tag: "Mira" },
    { gx: 7.5, gy: 7.5, c: "oklch(0.65 0.14 45)", tag: "Kira" },
    { gx: 5.6, gy: 9.4, c: "oklch(0.45 0.13 60)", tag: "Tam"  },
    { gx: 8.2, gy: 6.8, c: "oklch(0.50 0.08 60)", tag: "Orin" },
  ];

  return (
    <div style={{
      position: "relative",
      width, height,
      background: `linear-gradient(180deg, oklch(0.93 0.018 230) 0%, oklch(0.96 0.012 90) 80%)`,
      overflow: "hidden",
      ...style,
    }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {/* tile diamonds with thin side faces for slight depth */}
        {tiles.map(({ gx, gy, b }, i) => {
          const { x, y } = ts(gx, gy);
          return (
            <g key={i}>
              {/* tile top */}
              <path
                d={`M ${x} ${y} L ${x + TW/2} ${y + TH/2} L ${x} ${y + TH} L ${x - TW/2} ${y + TH/2} Z`}
                fill={fills[b]}
                stroke="oklch(0 0 0 / 0.10)"
                strokeWidth="0.5"
              />
            </g>
          );
        })}

        {/* render objects in their painter's order */}
        {/* combine buildings + trees + npcs, sort by their "depth" (gx + gy) */}
        {[
          ...buildings.map(b => ({ ...b, kind: "b", depth: b.gx + b.gy + 0.5 })),
          ...trees.map(([gx, gy]) => ({ kind: "t", gx, gy, depth: gx + gy + 0.4 })),
          ...npcs.map(n => ({ ...n, kind: "n", depth: n.gx + n.gy + 0.6 })),
        ].sort((a, b) => a.depth - b.depth).map((o, i) => {
          if (o.kind === "b") {
            const { x, y } = ts(o.gx, o.gy);
            const bh = 22 * o.h;  // wall height in px
            const bw2 = TW * o.w / 2;
            const bh2 = TH * o.w / 2;
            // wall front-left, front-right, then roof on top
            return (
              <g key={i}>
                {/* left wall */}
                <path
                  d={`M ${x} ${y + TH} L ${x - bw2} ${y + bh2 + TH/2}
                      L ${x - bw2} ${y + bh2 + TH/2 - bh}
                      L ${x} ${y + TH - bh} Z`}
                  fill={o.c} stroke="oklch(0 0 0 / 0.15)" strokeWidth="0.5"
                />
                {/* right wall */}
                <path
                  d={`M ${x} ${y + TH} L ${x + bw2} ${y + bh2 + TH/2}
                      L ${x + bw2} ${y + bh2 + TH/2 - bh}
                      L ${x} ${y + TH - bh} Z`}
                  fill={`color-mix(in oklch, ${o.c} 80%, black)`} stroke="oklch(0 0 0 / 0.15)" strokeWidth="0.5"
                />
                {/* roof diamond */}
                <path
                  d={`M ${x} ${y + TH - bh} L ${x + bw2} ${y + bh2 + TH/2 - bh}
                      L ${x} ${y + TH * 2 - bh} L ${x - bw2} ${y + bh2 + TH/2 - bh} Z`}
                  fill={o.roof} stroke="oklch(0 0 0 / 0.2)" strokeWidth="0.5"
                />
              </g>
            );
          }
          if (o.kind === "t") {
            const { x, y } = ts(o.gx, o.gy);
            return (
              <g key={i}>
                <ellipse cx={x} cy={y + TH * 1.2} rx="6" ry="2.5" fill="oklch(0 0 0 / 0.2)" />
                <path d={`M ${x} ${y + TH - 14} L ${x - 7} ${y + TH + 2} L ${x + 7} ${y + TH + 2} Z`}
                  fill="oklch(0.40 0.09 145)" stroke="oklch(0.30 0.07 145)" strokeWidth="0.5" />
              </g>
            );
          }
          if (o.kind === "n") {
            const { x, y } = ts(o.gx, o.gy);
            return (
              <g key={i}>
                <ellipse cx={x} cy={y + TH * 0.9} rx="4" ry="1.5" fill="oklch(0 0 0 / 0.25)" />
                <circle cx={x} cy={y + TH * 0.3} r="3.6" fill={o.c} stroke="white" strokeWidth="1.2" />
              </g>
            );
          }
        })}
      </svg>

      {label && (
        <div style={{
          position: "absolute", left: 10, bottom: 8,
          fontFamily: "var(--f-mono)", fontSize: 10,
          color: "var(--ink-3)", letterSpacing: "0.06em", textTransform: "uppercase",
          background: "var(--shade)", padding: "2px 6px", borderRadius: "var(--r-pill)",
          border: "1px solid var(--line)",
        }}>{label}</div>
      )}

      {scrubbed && <div className="sg-past-veil" />}
    </div>
  );
}

window.IsoWorld = IsoWorld;
// alias so old code paths still resolve
window.WorldPlaceholder = IsoWorld;
