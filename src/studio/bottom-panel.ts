// src/studio/bottom-panel.ts
// The docked bottom panel — a tab host. The pipeline-stage strip and the A/B
// model compare (moved out of the left accordion) are sibling tabs; only one
// body is visible at a time. The caller populates each body with the existing
// stage-dock / ab-section builders, so this module owns only the chrome.
import { h } from './theme';

export interface BottomPanel {
  pipelineBody: HTMLElement;
  abBody: HTMLElement;
  showPipeline: () => void;
  showAb: () => void;
}

export function buildBottomPanel(dock: HTMLElement): BottomPanel {
  dock.style.cssText += ';display:flex;flex-direction:column;overflow:hidden';

  const pipelineBody = h('div', { style: 'flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden' });
  const abBody = h('div', { style: 'flex:1 1 auto;min-height:0;overflow:auto;display:none' });

  const tabPipe = h('button', { class: 'sg-tab is-active' }, h('span', { text: '🔬' }), document.createTextNode('Pipeline'));
  const tabAb = h('button', { class: 'sg-tab' }, h('span', { text: '⚖' }), document.createTextNode('A/B Compare'), h('span', { class: 'sg-badge', text: 'paid' }));

  const select = (ab: boolean) => {
    tabAb.classList.toggle('is-active', ab);
    tabPipe.classList.toggle('is-active', !ab);
    abBody.style.display = ab ? 'block' : 'none';
    pipelineBody.style.display = ab ? 'none' : 'flex';
  };
  tabPipe.addEventListener('click', () => select(false));
  tabAb.addEventListener('click', () => select(true));

  const tabs = h('div', { class: 'sg-tabs' }, tabPipe, tabAb);
  dock.append(tabs, pipelineBody, abBody);

  return { pipelineBody, abBody, showPipeline: () => select(false), showAb: () => select(true) };
}
