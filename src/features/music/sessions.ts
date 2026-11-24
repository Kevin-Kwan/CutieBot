import type { Track } from 'discord-player';

/**
 * Pending /search results, held between the search reply and the user's
 * select-menu pick. Replaces the legacy 15-second message collector
 * (AUDIT §1.5) with a component flow: the session ID rides in the select
 * menu's custom ID (`music:select:<sessionId>`), and the pick is
 * authorized against the session's owner.
 */

export interface SearchSession {
  readonly userId: string;
  readonly guildId: string;
  readonly tracks: readonly Track[];
  readonly expiresAt: number;
}

/** How long a search result stays pickable. */
export const SEARCH_SESSION_TTL_MS = 120_000;

/**
 * Hard cap on live search sessions (Phase 6, P3): the Phase 4 store
 * only ever expired entries on access, so abandoned sessions
 * accumulated without bound. Inserting past the cap evicts the
 * soonest-to-expire sessions first.
 */
export const MAX_SEARCH_SESSIONS = 200;

export class SearchSessionStore {
  readonly #sessions = new Map<string, SearchSession>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  put(
    id: string,
    session: Omit<SearchSession, 'expiresAt'>,
    ttlMs: number = SEARCH_SESSION_TTL_MS,
  ): void {
    this.#sweep();
    this.#sessions.set(id, { ...session, expiresAt: this.#now() + ttlMs });
    if (this.#sessions.size > MAX_SEARCH_SESSIONS) {
      const byExpiry = [...this.#sessions.entries()].sort(
        (a, b) => a[1].expiresAt - b[1].expiresAt,
      );
      for (const [evictId] of byExpiry.slice(0, this.#sessions.size - MAX_SEARCH_SESSIONS)) {
        this.#sessions.delete(evictId);
      }
    }
  }

  /** Put a consumed session back (validation/connect failure paths only). */
  restore(id: string, session: SearchSession): void {
    this.#sessions.set(id, session);
  }

  /** Look a session up without consuming it; expired sessions are gone. */
  get(id: string): SearchSession | undefined {
    const session = this.#sessions.get(id);
    if (session === undefined) return undefined;
    if (session.expiresAt <= this.#now()) {
      this.#sessions.delete(id);
      return undefined;
    }
    return session;
  }

  /** Consume a session (one-shot: a successful pick cannot be replayed). */
  take(id: string): SearchSession | undefined {
    const session = this.get(id);
    if (session !== undefined) this.#sessions.delete(id);
    return session;
  }

  get size(): number {
    return this.#sessions.size;
  }

  #sweep(): void {
    const now = this.#now();
    for (const [id, session] of this.#sessions) {
      if (session.expiresAt <= now) this.#sessions.delete(id);
    }
  }
}

/** The feature-wide store instance (feature state lives in the feature). */
export const searchSessions = new SearchSessionStore();
