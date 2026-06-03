const STYLE = `
.sg-dev-panel {
  position: absolute;
  background: rgba(20,20,30,0.95);
  color: #e0e0e0;
  border: 1px solid #555;
  border-radius: 6px;
  font: 12px/1.5 monospace;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.sg-dev-body { flex: 1; display: flex; min-height: 0; }
.sg-dev-muted { color: #888; padding: 16px; text-align: center; }
.sg-dev-section-title { color: #8cf; font-size: 11px; margin: 8px 0 4px; }
.sg-dev-card {
  background: rgba(255,255,255,0.05);
  border: 1px solid #444;
  border-radius: 4px;
  padding: 8px;
  margin-bottom: 6px;
}
.sg-dev-row { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; margin-bottom: 4px; align-items: center; }
.sg-dev-label { color: #999; font-size: 11px; }
.sg-dev-input, .sg-dev-select, .sg-dev-textarea {
  background: rgba(0,0,0,0.3); color: #e0e0e0;
  border: 1px solid #555; border-radius: 3px;
  padding: 2px 4px; font: 11px monospace; box-sizing: border-box;
}
.sg-dev-input { width: 100%; }
.sg-dev-textarea { width: 100%; height: 80px; resize: vertical; font-size: 10px; }
.sg-dev-input--bad, .sg-dev-textarea--bad { border-color: #f44; }
.sg-dev-btn {
  all: unset; cursor: pointer; text-align: center;
  padding: 4px 8px; margin-bottom: 2px;
  background: rgba(255,255,255,0.1); color: #e0e0e0;
  border: 1px solid #555; border-radius: 3px; font: 11px sans-serif;
}
.sg-dev-btn:hover { background: rgba(255,255,255,0.2); }
.sg-dev-btn--danger:hover { background: rgba(255,80,80,0.3); color: #fbb; }
.sg-dev-btn[disabled] { opacity: 0.4; cursor: default; }
.sg-dev-search {
  width: 100%; padding: 4px 8px; box-sizing: border-box;
  background: rgba(0,0,0,0.3); color: #e0e0e0;
  border: 1px solid #555; border-radius: 3px; font: 11px sans-serif;
}
.sg-dev-tree { width: 210px; min-width: 210px; overflow: auto; border-right: 1px solid #444; padding: 6px; }
.sg-dev-detail { flex: 1; overflow: auto; padding: 8px; min-width: 0; }
.sg-dev-tree-node {
  cursor: pointer; padding: 1px 4px; border-radius: 3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sg-dev-tree-node:hover { background: rgba(255,255,255,0.08); }
.sg-dev-tree-node--selected { background: rgba(100,150,255,0.25); color: #cfe6ff; }
.sg-dev-tree-toggle { display: inline-block; width: 12px; color: #888; }
.sg-dev-link { color: #8cf; cursor: pointer; text-decoration: underline; }
.sg-dev-toolbar {
  position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
  display: flex; gap: 4px; align-items: center;
  padding: 4px 6px; background: rgba(20,20,30,0.95);
  border: 1px solid #555; border-radius: 6px; font: 11px sans-serif;
}
.sg-dev-toolbar__btn {
  all: unset; cursor: pointer; padding: 4px 8px; border-radius: 3px;
  color: #cfe0f0; background: rgba(255,255,255,0.06); border: 1px solid #555;
}
.sg-dev-toolbar__btn:hover { background: rgba(255,255,255,0.14); }
.sg-dev-toolbar__btn--active { background: rgba(100,150,255,0.30); color: #eaf3ff; border-color: #88a; }
.sg-dev-rail-hint {
  position: absolute; top: 0; bottom: 0; width: 4px;
  background: rgba(100,150,255,0.5); pointer-events: none; display: none;
}
`;

export function injectDevStyles(): void {
  if (document.getElementById('sg-dev-styles')) return;
  const el = document.createElement('style');
  el.id = 'sg-dev-styles';
  el.textContent = STYLE;
  document.head.appendChild(el);
}
