// src/studio/bottom-panel.ts
// The docked bottom panel — a tab host. The pipeline-stage strip, the A/B model
// compare, and the TTI reference eval are sibling tabs; only one body is visible at
// a time. The caller populates each body with the existing stage-dock / ab-section /
// reference-panel builders, so this module owns only the chrome.
import { h } from './theme';

export interface BottomPanel {
  pipelineBody: HTMLElement;
  abBody: HTMLElement;
  refBody: HTMLElement;
  showPipeline: () => void;
  showAb: () => void;
  showRef: () => void;
}

export function buildBottomPanel(dock: HTMLElement): BottomPanel {
  dock.style.cssText += ';display:flex;flex-direction:column;overflow:hidden';

  const pipelineBody = h('div', { style: 'flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden' });
  const abBody = h('div', { style: 'flex:1 1 auto;min-height:0;overflow:auto;display:none' });
  const refBody = h('div', { style: 'flex:1 1 auto;min-height:0;overflow:auto;display:none' });

  const tabPipe = h('button', { class: 'sg-tab is-active' }, h('span', { text: '🔬' }), document.createTextNode('Pipeline'));
  const tabAb = h('button', { class: 'sg-tab' }, h('span', { text: '⚖' }), document.createTextNode('A/B Compare'), h('span', { class: 'sg-badge', text: 'paid' }));
  const tabRef = h('button', { class: 'sg-tab' }, h('span', { text: '⟐' }), document.createTextNode('Reference'));

  // One-of-three selection: 'pipe' | 'ab' | 'ref'.
  const select = (which: 'pipe' | 'ab' | 'ref') => {
    tabPipe.classList.toggle('is-active', which === 'pipe');
    tabAb.classList.toggle('is-active', which === 'ab');
    tabRef.classList.toggle('is-active', which === 'ref');
    pipelineBody.style.display = which === 'pipe' ? 'flex' : 'none';
    abBody.style.display = which === 'ab' ? 'block' : 'none';
    refBody.style.display = which === 'ref' ? 'block' : 'none';
  };
  tabPipe.addEventListener('click', () => select('pipe'));
  tabAb.addEventListener('click', () => select('ab'));
  tabRef.addEventListener('click', () => select('ref'));

  const tabs = h('div', { class: 'sg-tabs' }, tabPipe, tabAb, tabRef);
  dock.append(tabs, pipelineBody, abBody, refBody);

  return {
    pipelineBody, abBody, refBody,
    showPipeline: () => select('pipe'), showAb: () => select('ab'), showRef: () => select('ref'),
  };
}
