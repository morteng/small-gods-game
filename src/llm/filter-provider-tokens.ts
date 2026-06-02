/**
 * Strip provider tool-call delimiter tokens that leak into the visible text
 * stream. DeepSeek V4 Flash emits fullwidth-pipe `｜DSML｜tool_calls>`; Kimi
 * emits ASCII `<|tool_calls_begin|>`; OpenRouter/DeepInfra sometimes rewrite
 * `｜`/`▁` to ASCII, leaving a bare `_tool_calls>`. A lone decorative `｜word｜`
 * is intentionally preserved.
 *
 * Ported verbatim from pikkolo-cms-mvp dashboard/static/js/pikkolo-tools.js
 * (and mirrored there + in api/.../streaming.py). Keep in sync if pikkolo's
 * copy changes. Observed prod 2026-05-21 (Drammen) and 2026-06-01.
 */
export function filterProviderTokens(text: string): string {
  if (!text) return '';
  // Bracketed forms: <｜...｜> (DeepSeek), <|...|> (Kimi), </｜...> close-tag.
  text = text.replace(/<\s*｜[^\n>]*?｜\s*[>～]/g, '');
  text = text.replace(/<\s*\|[^\n>]*?\|\s*>/g, '');
  text = text.replace(/<\/\s*｜[A-Za-z][A-Za-z0-9_]{0,30}(?:｜[A-Za-z0-9_]*){1,3}\s*[>～]/g, '');
  // Bare `>`-closed leaks where the wrapping bracket was dropped.
  text = text.replace(/｜[A-Za-z][A-Za-z0-9_]{1,30}(?:｜[A-Za-z0-9_]*){1,3}\s*[>～]/g, '');
  text = text.replace(/\|[A-Za-z][A-Za-z0-9_]{1,30}(?:\|[A-Za-z0-9_]*){1,3}\s*>/g, '');
  // Fullwidth-pipe-closed variants: ｜tool▁sep｜ (▁ is the tell) and the
  // ｜DSML｜...｜ marker run. A lone decorative ｜word｜ survives.
  text = text.replace(/｜[A-Za-z0-9_]*▁[A-Za-z0-9_▁]*[｜>～]/g, '');
  text = text.replace(/<?\/?｜DSML｜[A-Za-z0-9_]*[｜>～]/g, '');
  // ASCII-rewritten DeepSeek delimiters (bare `_tool_calls>`).
  text = text.replace(/<?\/?_?tool_(?:calls?|sep|outputs?)(?:_(?:begin|end|sep))?>/g, '');
  return text;
}
