/**
 * LLM Display — shows NPC dialogue and narration from LLM backfill.
 */

export interface LlmDisplayOptions {
  onClose?: () => void;
}

export interface LlmDisplayHandle {
  showNarration(text: string): void;
  showDialogue(npcName: string, text: string): void;
  showBoth(npcName: string, dialogue: string, narration?: string): void;
  hide(): void;
  destroy(): void;
}

const STYLE = `
.sg-llm-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.6);
  z-index: 900;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}
.sg-llm-overlay.visible {
  opacity: 1;
  pointer-events: auto;
}
.sg-llm-card {
  background: #1a1a2e;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 12px;
  padding: 20px 24px;
  max-width: 480px;
  min-width: 320px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  color: #e0e0e0;
  font: 14px/1.6 -apple-system, sans-serif;
}
.sg-llm-card.narration {
  font-style: italic;
  color: #b0b0d0;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.sg-llm-card.dialogue {
  position: relative;
  padding-left: 16px;
  border-left: 3px solid #FFD54F;
}
.sg-llm-card.dialogue .speaker {
  font-weight: bold;
  color: #FFD54F;
  margin-bottom: 4px;
  font-size: 13px;
}
.sg-llm-close {
  all: unset;
  cursor: pointer;
  position: absolute;
  top: 8px;
  right: 12px;
  color: rgba(255,255,255,0.4);
  font-size: 18px;
  transition: color 0.1s;
}
.sg-llm-close:hover {
  color: rgba(255,255,255,0.8);
}
`;

export function createLlmDisplay(container: HTMLElement, opts: LlmDisplayOptions = {}): LlmDisplayHandle {
  // Inject styles once
  if (!document.querySelector('#sg-llm-styles')) {
    const style = document.createElement('style');
    style.id = 'sg-llm-styles';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.className = 'sg-llm-overlay';
  
  const card = document.createElement('div');
  card.className = 'sg-llm-card';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'sg-llm-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    hide();
    opts.onClose?.();
  });

  card.appendChild(closeBtn);
  overlay.appendChild(card);
  container.appendChild(overlay);

  // Auto-hide on click outside
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      hide();
      opts.onClose?.();
    }
  });

  function show(): void {
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
    });
  }

  function hide(): void {
    overlay.classList.remove('visible');
  }

  function clearCard(): void {
    // Remove all children except close button
    while (card.firstChild) {
      if (card.firstChild === closeBtn) break;
      card.removeChild(card.firstChild);
    }
    // Reset classes
    card.className = 'sg-llm-card';
  }

  const handle: LlmDisplayHandle = {
    showNarration(text: string): void {
      clearCard();
      const narration = document.createElement('div');
      narration.className = 'narration';
      narration.textContent = text;
      card.insertBefore(narration, closeBtn);
      show();
    },

    showDialogue(npcName: string, text: string): void {
      clearCard();
      const wrapper = document.createElement('div');
      wrapper.className = 'dialogue';
      
      const speaker = document.createElement('div');
      speaker.className = 'speaker';
      speaker.textContent = npcName;
      
      const dialogue = document.createElement('div');
      dialogue.textContent = text;
      
      wrapper.appendChild(speaker);
      wrapper.appendChild(dialogue);
      card.insertBefore(wrapper, closeBtn);
      show();
    },

    showBoth(npcName: string, dialogue: string, narration?: string): void {
      clearCard();
      
      if (narration) {
        const nar = document.createElement('div');
        nar.className = 'narration';
        nar.textContent = narration;
        card.insertBefore(nar, closeBtn);
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'dialogue';
      
      const speaker = document.createElement('div');
      speaker.className = 'speaker';
      speaker.textContent = npcName;
      
      const dlg = document.createElement('div');
      dlg.textContent = dialogue;
      
      wrapper.appendChild(speaker);
      wrapper.appendChild(dlg);
      card.insertBefore(wrapper, closeBtn);
      
      show();
    },

    hide,
    
    destroy(): void {
      overlay.remove();
    },
  };

  return handle;
}
