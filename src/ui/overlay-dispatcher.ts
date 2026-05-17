export interface OverlayHitArea {
  x: number; y: number; w: number; h: number;
  action: string;       // 'whisper' | future: 'omen' | 'dream' | 'miracle' | 'possess' | ...
  payload: unknown;
  active: boolean;
}

type Handler = (payload: unknown) => boolean | void;

export class OverlayDispatcher {
  private handlers = new Map<string, Handler>();

  register(action: string, handler: Handler): void {
    this.handlers.set(action, handler);
  }

  tryDispatch(sx: number, sy: number, areas: OverlayHitArea[]): boolean {
    for (const a of areas) {
      if (sx < a.x || sx > a.x + a.w || sy < a.y || sy > a.y + a.h) continue;
      if (!a.active) continue;
      const handler = this.handlers.get(a.action);
      if (handler) handler(a.payload);
      return true;  // hit-test absorbs the click even if no handler is registered
    }
    return false;
  }
}
