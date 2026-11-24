import type { Player } from 'discord-player';
import type { Client } from 'discord.js';
import type { Db, MongoClient } from 'mongodb';
import type { AppConfig } from '../config/env.js';
import type { CooldownStore } from './cooldowns.js';
import type { AppLogger } from './logger.js';
import type { Registry } from './registry.js';

/** Live Mongo handles, created once at boot by src/db/mongo.ts. */
export interface DbHandles {
  readonly client: MongoClient;
  readonly db: Db;
}

/**
 * Everything a handler needs, passed explicitly — no globals (PLAN §1, §11).
 * Feature services (economy repo, music queue helpers, AI provider) attach in
 * their own phases and are reached through feature modules, not this object.
 */
export interface AppContext {
  readonly client: Client;
  readonly player: Player;
  readonly db: DbHandles;
  readonly config: AppConfig;
  readonly logger: AppLogger;
  readonly registry: Registry;
  readonly cooldowns: CooldownStore;
}
