import { Game } from '@/game';

export interface EmbedMessage {
  type: string;
  payload?: any;
}

export function listenForHost(game: Game): () => void {
  function onMessage(event: MessageEvent<EmbedMessage>) {
    const { type, payload } = event.data || {};
    switch (type) {
      case 'generate':
        game.generateWorld(payload?.worldSeed, payload?.terrainOptions);
        break;
      case 'getState':
        window.parent.postMessage({ type: 'state', payload: { /* game state summary */ } }, '*');
        break;
    }
  }

  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
