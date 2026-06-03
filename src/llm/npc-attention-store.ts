/** One round of a whisper conversation: the god's whisper and the NPC's reaction. */
export interface WhisperTurn {
  whisper: string;
  dialogue: string;
  /** sim tick at which the whisper was sent (for context/labels). */
  tick: number;
  /** soft belief bonus the LLM judged this whisper earned, clamped ±0.10 (Slice 2). */
  faithBonus?: number;
  /** true when the LLM was unavailable and only the deterministic floor applied (Slice 2). */
  degraded?: boolean;
}

/** A typed hyperlink on a mind page. */
export interface MindLink {
  label: string;
  kind: 'entity' | 'concept';
  /** validated sim entity id, present only for resolved entity links (Slice 3). */
  entityId?: string;
}

/** A generated mind-wiki page (Slice 3). */
export interface MindPage {
  prose: string;
  links: MindLink[];
  depth: number;
}

/**
 * Narration-layer state for NPC attention (Whisper transcripts + Mind page cache).
 *
 * This is deliberately NOT part of GameState and is never snapshotted. It is
 * session-scoped and wiped by clearAll() whenever the timeline restores a
 * snapshot (scrub / commit / era-skip), mirroring how the command queue clears.
 */
export class NpcAttentionStore {
  private transcripts = new Map<string, WhisperTurn[]>();
  private pages = new Map<string, Map<string, MindPage>>();

  getTranscript(npcId: string): WhisperTurn[] {
    return this.transcripts.get(npcId) ?? [];
  }

  appendTurn(npcId: string, turn: WhisperTurn): void {
    const list = this.transcripts.get(npcId);
    if (list) list.push(turn);
    else this.transcripts.set(npcId, [turn]);
  }

  getPage(npcId: string, path: string): MindPage | undefined {
    return this.pages.get(npcId)?.get(path);
  }

  putPage(npcId: string, path: string, page: MindPage): void {
    let byPath = this.pages.get(npcId);
    if (!byPath) { byPath = new Map(); this.pages.set(npcId, byPath); }
    byPath.set(path, page);
  }

  /** Drop one cached page so the next read regenerates it (used to re-read the surface after a whisper). */
  invalidatePage(npcId: string, path: string): void {
    this.pages.get(npcId)?.delete(path);
  }

  clearAll(): void {
    this.transcripts.clear();
    this.pages.clear();
  }
}
