import type { Scheduler } from '@/core/scheduler';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createFloatingPanel } from '@/dev/FloatingPanel';
import type { DockManager } from '@/dev/dock-manager';

export interface TimeDebugPanelHandle {
  element: HTMLElement;
  update(clock: SimClock, scheduler: Scheduler, eventLog: EventLog): void;
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  destroy(): void;
}

/**
 * Create a disabled placeholder button for a feature that is not yet wired up.
 * Keeps the dev UI honest: the control is visible (so the layout reads true)
 * but clearly non-functional rather than silently doing nothing on click.
 */
function makeStubButton(label: string, reason: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.disabled = true;
  btn.title = `${reason} (not yet implemented)`;
  btn.style.cssText = [
    'flex:1', 'padding:6px 8px', 'background:rgba(255,255,255,0.04)',
    'color:#777', 'border:1px dashed #555', 'border-radius:3px',
    'font:11px sans-serif', 'cursor:not-allowed', 'opacity:0.6',
  ].join(';');
  return btn;
}

export function mountTimeDebugPanel(
  container: HTMLElement,
  deps: {
    clock: SimClock;
    scheduler: Scheduler;
    eventLog: EventLog;
    dock?: DockManager;
  }
): TimeDebugPanelHandle {
  const fp = createFloatingPanel({ container, id: 'time', title: '⏱ Time Debug', dock: deps.dock, width: 280, anchor: { top: '60px', left: '280px' } });
  const body = fp.body;

  // Speed controls
  const speedSection = document.createElement('div');
  speedSection.style.cssText = 'margin-bottom:10px;';

  const speedLabel = document.createElement('div');
  speedLabel.style.cssText = 'color:#8cf; font-size:11px; margin-bottom:4px;';
  speedLabel.textContent = 'Speed Presets:';
  speedSection.appendChild(speedLabel);

  const speedBtns = document.createElement('div');
  speedBtns.style.cssText = 'display:flex; gap:4px; flex-wrap:wrap;';
  const speeds = [
    { label: '⏸ 0×', value: 0 },
    { label: '▶ 1×', value: 1 },
    { label: '▶▶ 2×', value: 2 },
    { label: '▶▶▶ 5×', value: 5 },
    { label: '⚡ 10×', value: 10 },
  ];

  // Initialize button styles based on current rate
  const currentRate = deps.scheduler.getRate();

  for (const speed of speeds) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = speed.label;
    const isActive = currentRate === speed.value;
    btn.style.cssText = [
      'flex:1', 'padding:4px 6px',
      `background:${isActive ? 'rgba(74,158,255,0.4)' : 'rgba(255,255,255,0.1)'}`,
      'color:#e0e0e0',
      `border:1px solid ${isActive ? '#4a9eff' : '#555'}`,
      'border-radius:3px',
      'font:10px sans-serif', 'cursor:pointer', 'min-width:50px',
    ].join(';');
    btn.addEventListener('mouseenter', () => {
      if (deps.scheduler.getRate() !== speed.value) btn.style.background = 'rgba(255,255,255,0.2)';
    });
    btn.addEventListener('mouseleave', () => {
      if (deps.scheduler.getRate() !== speed.value) {
        btn.style.background = 'rgba(255,255,255,0.1)';
        btn.style.borderColor = '#555';
      }
    });
    btn.addEventListener('click', () => {
      deps.scheduler.setRate(speed.value);
      // Update all button styles
      const buttons = speedBtns.querySelectorAll('button');
      buttons.forEach((b, i) => {
        const active = speeds[i].value === speed.value;
        b.style.background = active ? 'rgba(74,158,255,0.4)' : 'rgba(255,255,255,0.1)';
        b.style.borderColor = active ? '#4a9eff' : '#555';
      });
      console.log(`[dev] Speed set to ${speed.value}x`);
    });
    speedBtns.appendChild(btn);
  }
  speedSection.appendChild(speedBtns);
  body.appendChild(speedSection);

  // Tick stepping
  const stepSection = document.createElement('div');
  stepSection.style.cssText = 'margin-bottom:10px; padding-top:8px; border-top:1px solid #444;';

  const stepLabel = document.createElement('div');
  stepLabel.style.cssText = 'color:#8cf; font-size:11px; margin-bottom:4px;';
  stepLabel.textContent = 'Tick Stepping:';
  stepSection.appendChild(stepLabel);

  const stepBtns = document.createElement('div');
  stepBtns.style.cssText = 'display:flex; gap:4px;';

  const stepBtn = document.createElement('button');
  stepBtn.type = 'button';
  stepBtn.textContent = '⏭ Step 1 Tick';
  stepBtn.style.cssText = [
    'flex:1', 'padding:6px 8px', 'background:rgba(74,158,255,0.2)',
    'color:#4a9eff', 'border:1px solid #4a9eff', 'border-radius:3px',
    'font:11px sans-serif', 'cursor:pointer',
  ].join(';');
  stepBtn.addEventListener('mouseenter', () => { stepBtn.style.background = 'rgba(74,158,255,0.4)'; });
  stepBtn.addEventListener('mouseleave', () => { stepBtn.style.background = 'rgba(74,158,255,0.2)'; });
  stepBtn.addEventListener('click', () => {
    // Step by advancing the clock by 1 tick (assuming 1Hz = 1000ms)
    const clock = deps.clock;
    const currentRate = deps.scheduler.getRate();
    if (currentRate === 0) {
      // If paused, do a manual tick
      clock.advance(1000); // 1 second sim time
      console.log(`[dev] Stepped 1 tick (clock now: ${clock.now()})`);
    } else {
      // Temporarily pause, tick, then restore
      deps.scheduler.setRate(0);
      setTimeout(() => deps.scheduler.setRate(currentRate), 100);
      console.log('[dev] Stepped (paused briefly)');
    }
  });
  stepBtns.appendChild(stepBtn);
  stepSection.appendChild(stepBtns);
  body.appendChild(stepSection);

  // Snapshots
  const snapSection = document.createElement('div');
  snapSection.style.cssText = 'margin-bottom:10px; padding-top:8px; border-top:1px solid #444;';

  const snapLabel = document.createElement('div');
  snapLabel.style.cssText = 'color:#8cf; font-size:11px; margin-bottom:4px;';
  snapLabel.textContent = 'State Snapshots:';
  snapSection.appendChild(snapLabel);

  const snapBtns = document.createElement('div');
  snapBtns.style.cssText = 'display:flex; gap:4px;';

  const saveBtn = makeStubButton('💾 Save', 'Snapshot save not yet implemented');
  snapBtns.appendChild(saveBtn);

  const loadBtn = makeStubButton('📂 Load', 'Snapshot load not yet implemented');
  snapBtns.appendChild(loadBtn);
  snapSection.appendChild(snapBtns);
  body.appendChild(snapSection);

  // Event injection
  const eventSection = document.createElement('div');
  eventSection.style.cssText = 'margin-bottom:10px; padding-top:8px; border-top:1px solid #444;';

  const eventLabel = document.createElement('div');
  eventLabel.style.cssText = 'color:#8cf; font-size:11px; margin-bottom:4px;';
  eventLabel.textContent = 'Inject Event:';
  eventSection.appendChild(eventLabel);

  const eventSelect = document.createElement('select');
  eventSelect.style.cssText = 'width:100%; padding:4px; background:#1a1a2e; color:#e0e0e0; border:1px solid #555; border-radius:3px; font-size:11px; margin-bottom:4px; cursor:pointer;';
  const events = ['drought', 'festival', 'dispute', 'plague', 'raiders', 'trading_caravan'];
  for (const evt of events) {
    const opt = document.createElement('option');
    opt.value = evt;
    opt.textContent = evt;
    eventSelect.appendChild(opt);
  }
  eventSection.appendChild(eventSelect);

  const injectBtn = makeStubButton('💉 Inject', 'Event injection not yet implemented');
  injectBtn.style.width = '100%';
  eventSelect.disabled = true;
  eventSelect.style.opacity = '0.4';
  eventSection.appendChild(injectBtn);
  body.appendChild(eventSection);

  // Time display
  const timeDisplay = document.createElement('div');
  timeDisplay.style.cssText = 'margin-top:8px; padding-top:8px; border-top:1px solid #444; font-size:11px; color:#8cf;';
  timeDisplay.textContent = 'Tick: 0 | Time: 0s';
  body.appendChild(timeDisplay);

  function update(clock: SimClock, scheduler: Scheduler, _eventLog: EventLog): void {
    if (!fp.isVisible()) return;

    const tick = clock.now();
    const rate = scheduler.getRate();
    const paused = rate === 0;

    timeDisplay.textContent = `Tick: ${tick} | Rate: ${rate}x ${paused ? '(PAUSED)' : ''}`;

    // Update speed button highlights
    const buttons = speedBtns.querySelectorAll('button');
    buttons.forEach((btn, idx) => {
      const speed = speeds[idx].value;
      if (speed === rate) {
        btn.style.background = 'rgba(74,158,255,0.4)';
        btn.style.borderColor = '#4a9eff';
      } else {
        btn.style.background = 'rgba(255,255,255,0.1)';
        btn.style.borderColor = '#555';
      }
    });
  }

  return {
    element: fp.element,
    update,
    show: fp.show,
    hide: fp.hide,
    toggle: fp.toggle,
    isVisible: fp.isVisible,
    destroy: () => fp.destroy(),
  };
}
