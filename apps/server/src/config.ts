// Persistent node/agent configuration (SQLite). This is the source of truth
// for what the panel tracks — no hardcoding. Seeded once from env AGENTS if
// the table is empty, then fully managed via the CRUD API / Settings UI.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb, type DbLike } from './sqlite.ts';

export interface NodeCfg {
  id: string;
  name: string;
  url: string;
  enabled: number;
  /** Display/iteration order. Lower sorts first; panel-added nodes default to 1000. */
  ord?: number;
}

export class ConfigStore {
  private db: DbLike;
  constructor(path: string, seed: NodeCfg[]) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = openDb(path);
    this.db.exec(`PRAGMA journal_mode=WAL;`);
    this.db.exec(`
CREATE TABLE IF NOT EXISTS config_nodes(
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL DEFAULT '',
  url     TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  ord     INTEGER NOT NULL DEFAULT 1000
) WITHOUT ROWID;`);
    // Migration for databases created before the `ord` column existed.
    const cols = this.db.prepare('PRAGMA table_info(config_nodes)').all() as { name: string }[];
    if (!cols.some((x) => x.name === 'ord')) {
      this.db.exec('ALTER TABLE config_nodes ADD COLUMN ord INTEGER NOT NULL DEFAULT 1000');
    }
    const c = this.db.prepare('SELECT COUNT(*) c FROM config_nodes').get() as { c: number };
    if (c.c === 0 && seed.length) {
      const ins = this.db.prepare('INSERT INTO config_nodes(id, name, url, enabled, ord) VALUES(?,?,?,1,?)');
      this.db.exec('BEGIN');
      try {
        seed.forEach((n, i) => ins.run(n.id, n.name, n.url, i));
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    } else if (seed.length) {
      // Keep the configured `AGENTS` order authoritative for nodes that were
      // never explicitly ordered (ord still at its default). Without this, the
      // list is ordered by id and `nodes[0]` may not be the configured head.
      // Nodes added later via the panel keep ord=1000 and sort last.
      const upd = this.db.prepare('UPDATE config_nodes SET ord=? WHERE id=? AND ord=1000');
      this.db.exec('BEGIN');
      try {
        seed.forEach((n, i) => upd.run(i, n.id));
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
  }

  list(): NodeCfg[] {
    return this.db
      .prepare('SELECT id, name, url, enabled, ord FROM config_nodes ORDER BY ord, id')
      .all() as NodeCfg[];
  }

  get(id: string): NodeCfg | undefined {
    return this.db.prepare('SELECT id, name, url, enabled, ord FROM config_nodes WHERE id=?').get(id) as
      | NodeCfg
      | undefined;
  }

  upsert(cfg: NodeCfg): void {
    // INSERT OR REPLACE deletes+inserts, which would reset `ord` to its default;
    // carry the existing order (or an explicitly supplied one) across edits.
    const cur = this.get(cfg.id);
    const ord = cfg.ord ?? cur?.ord ?? 1000;
    this.db
      .prepare('INSERT OR REPLACE INTO config_nodes(id, name, url, enabled, ord) VALUES(?,?,?,?,?)')
      .run(cfg.id, cfg.name, cfg.url, cfg.enabled === 0 ? 0 : 1, ord);
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM config_nodes WHERE id=?').run(id);
  }
}
