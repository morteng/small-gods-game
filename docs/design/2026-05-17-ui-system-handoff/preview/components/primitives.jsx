/* global React */
const { useState, useEffect, useRef, useMemo } = React;

// PRIMITIVES — building blocks. Friendly, restrained, paper-light.
// API matches v1 so the rest of the components can compose without rewrites.

function Panel({ children, raised, alt, floating, style, className = "", ...rest }) {
  const cls = [
    "sg-card",
    alt ? "sg-card--alt" : "",
    floating ? "sg-card--floating" : "",
    className,
  ].filter(Boolean).join(" ");
  return <div className={cls} style={style} {...rest}>{children}</div>;
}

function Chip({ children, onClick, style, title }) {
  return (
    <button className="sg-chip" onClick={onClick} style={style} title={title}>
      {children}
    </button>
  );
}

function Eyebrow({ children, tone, style }) {
  const color = tone === "you" ? "var(--you)" : tone === "time" ? "var(--time)" : tone === "life" ? "var(--w-leaf)" : tone === "danger" ? "var(--danger)" : null;
  return <div className="sg-eyebrow" style={{ ...(color ? { color } : null), ...style }}>{children}</div>;
}

function Btn({ children, tone, ghost, primary, big, icon, active, hint, onClick, style, title, type }) {
  const cls = [
    "sg-btn",
    ghost ? "sg-btn--ghost" : "",
    primary ? "sg-btn--primary" : "",
    tone === "time" ? "sg-btn--time" : "",
    tone === "danger" ? "sg-btn--danger" : "",
    big ? "sg-btn--big" : "",
    icon ? "sg-btn--icon" : "",
    active ? "is-active" : "",
  ].filter(Boolean).join(" ");
  return (
    <button className={cls} onClick={onClick} style={style} aria-pressed={active || undefined} title={title}>
      {children}
      {hint != null && <span className="sg-key" aria-hidden>{hint}</span>}
    </button>
  );
}

function Key({ children }) { return <span className="sg-key">{children}</span>; }

function Badge({ children, tone, style }) {
  const cls = "sg-badge" + (tone ? " sg-badge--" + tone : "");
  return <span className={cls} style={style}>{children}</span>;
}

function Sigil({ glyph = "ƒ", tone, size, style }) {
  const cls = [
    "sg-sigil",
    tone === "time"   ? "sg-sigil--time" : "",
    tone === "danger" ? "sg-sigil--danger" : "",
    size === "lg" ? "sg-sigil--lg" : size === "xl" ? "sg-sigil--xl" : "",
  ].filter(Boolean).join(" ");
  return <span className={cls} style={style}>{glyph}</span>;
}

function Meter({ value = 0.5, tone, pips = [], style, height }) {
  const cls = "sg-meter" + (tone ? " sg-meter--" + tone : "");
  return (
    <div className={cls} style={{ ...(height ? { height } : null), ...style }}>
      <div className="sg-meter__fill" style={{ width: Math.max(0, Math.min(1, value)) * 100 + "%" }} />
      {pips.map((p, i) => <span key={i} className="sg-meter__pip" style={{ left: p * 100 + "%" }} />)}
    </div>
  );
}

function Hr({ style }) { return <hr className="sg-hr" style={style} />; }

// Lightweight inline icon — 14×14 svg, 1.4 stroke
function I({ d, fill, w = 14, h = 14, viewBox = "0 0 16 16" }) {
  return (
    <svg viewBox={viewBox} width={w} height={h} fill={fill || "none"} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}

// Glyphs — kept small, friendly, recognizable
const G = {
  whisper:    <I d={<><path d="M3 7 Q5 5 7 7 T 11 7" /><path d="M3 11 Q5 9 7 11 T 13 11" /></>} />,
  miracle:    <I d={<path d="M8 2 L9.2 6.2 L13.5 7 L9.2 7.8 L8 12 L6.8 7.8 L2.5 7 L6.8 6.2 Z" fill="currentColor" strokeWidth="0.8" />} />,
  beliefRise: <I d={<><path d="M2 12 L6 8 L9 10 L14 4" /><path d="M11 4 L14 4 L14 7" /></>} />,
  beliefFall: <I d={<><path d="M2 4 L6 8 L9 6 L14 12" /><path d="M11 12 L14 12 L14 9" /></>} />,
  birth:      <I d={<><circle cx="8" cy="8" r="3" /><path d="M8 2 L8 4 M8 12 L8 14 M2 8 L4 8 M12 8 L14 8" /></>} />,
  death:      <I d={<><path d="M3 8 L13 8" /><path d="M5 5 L5 11 M11 5 L11 11" /></>} />,
  realize:    <I d={<><rect x="3.5" y="3.5" width="9" height="9" strokeDasharray="2 2" /><rect x="6" y="6" width="4" height="4" fill="currentColor" strokeWidth="0.8" /></>} />,
  rival:      <I d={<><path d="M8 2 L13 6 L11 13 L5 13 L3 6 Z" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /></>} />,
  mood:       <I d={<path d="M3 6 Q8 1 13 6 Q13 12 8 14 Q3 12 3 6 Z" />} />,
  pause:      <I d={<><rect x="5" y="3" width="2.2" height="10" fill="currentColor" strokeWidth="0.5"/><rect x="8.8" y="3" width="2.2" height="10" fill="currentColor" strokeWidth="0.5"/></>} />,
  play:       <I d={<path d="M5 3 L12 8 L5 13 Z" fill="currentColor" strokeWidth="0.5" />} />,
  rewindEnd:  <I d={<><rect x="3" y="3" width="2" height="10" fill="currentColor" strokeWidth="0.5"/><path d="M13 3 L7 8 L13 13 Z" fill="currentColor" strokeWidth="0.5"/></>} />,
  forwardEnd: <I d={<><rect x="11" y="3" width="2" height="10" fill="currentColor" strokeWidth="0.5"/><path d="M3 3 L9 8 L3 13 Z" fill="currentColor" strokeWidth="0.5"/></>} />,
  clock:      <I d={<><circle cx="8" cy="8" r="5.5" /><path d="M8 5 L8 8 L10.5 9.5" /></>} />,
  book:       <I d={<><path d="M3 4 L8 5 L13 4 L13 13 L8 14 L3 13 Z" /><path d="M8 5 L8 14" /></>} />,
  branch:     <I d={<><circle cx="4" cy="8" r="1.5" /><circle cx="12" cy="4" r="1.5" /><circle cx="12" cy="12" r="1.5" /><path d="M5.5 7 Q9 5 10.5 4 M5.5 9 Q9 11 10.5 12" /></>} />,
  reroll:     <I d={<><path d="M3 8 A5 5 0 0 1 13 8" /><path d="M11 5 L13 8 L10 8.5" /><path d="M13 8 A5 5 0 0 1 3 8" strokeOpacity="0.3" /></>} />,
  chat:       <I d={<path d="M3 4 L13 4 L13 11 L8 11 L5 13 L5 11 L3 11 Z" />} />,
  eye:        <I d={<><path d="M2 8 Q8 2 14 8 Q8 14 2 8 Z" /><circle cx="8" cy="8" r="2" /></>} />,
  pin:        <I d={<><path d="M8 2 C 5 2 4 5 6 8 L 8 14 L 10 8 C 12 5 11 2 8 2 Z" /><circle cx="8" cy="6" r="1.4" fill="currentColor" strokeWidth="0.5" /></>} />,
  chevDown:   <I d={<path d="M3 6 L8 11 L13 6" />} />,
  chevUp:     <I d={<path d="M3 10 L8 5 L13 10" />} />,
  close:      <I d={<><path d="M4 4 L12 12" /><path d="M12 4 L4 12" /></>} />,
  settings:   <I d={<><circle cx="8" cy="8" r="2.5" /><path d="M8 1 L8 3 M8 13 L8 15 M1 8 L3 8 M13 8 L15 8 M3 3 L4.5 4.5 M11.5 11.5 L13 13 M3 13 L4.5 11.5 M11.5 4.5 L13 3" /></>} />,
};

Object.assign(window, { Panel, Chip, Eyebrow, Btn, Key, Badge, Sigil, Meter, Hr, G });
