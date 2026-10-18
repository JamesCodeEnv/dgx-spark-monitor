// Puller: periodically syncs each configured agent's local TSDB into the
// central store over plain HTTP (no SSH in the runtime data path).
// Targets are dynamic — reconciled from the config store on every cycle,
// so adding/editing/removing nodes via the Settings UI takes effect live.
import { Store } from './store.ts';
import type { NodeCfg } from './config.ts';

export interface Agent {
  id: string;       // e.g. head / worker / node-a
  name?: string;    // display name
  url: string;      // e.g. http://<IP_MGMT_A>:9100
  hostname?: string;// reported by the agent itself
  ok: boolean;
  lastOkTs: number;
  rows: number;     // rows pulled in last sync
  lastError?: string; // last sync failure (shown in /api/nodes)
}

export class Puller {
  private agents = new Map<string, Agent>();
  private getCfg: () => NodeCfg[];
  private store: Store;
  private intervalMs: number;
  // A node whose /changes keeps failing while it is otherwise reachable (a poisoned window, a
  // huge backlog) would otherwise stall forever: `since` never advances. These let us skip past it.
  private stallFloor = new Map<string, number>();
  private failStreak = new Map<string, number>();

  constructor(getCfg: () => NodeCfg[], store: Store, intervalMs = 10_000) {
    this.getCfg = getCfg;
    this.store = store;
    this.intervalMs = intervalMs;
  }

  start() {
    void this.syncAll();
    setInterval(() => void this.syncAll(), this.intervalMs);
  }

  // Reconcile in-memory targets with the persisted config (add/update/remove).
  private reconcile(): void {
    const cfgs = this.getCfg().filter((c) => c.enabled === 1);
    const want = new Set(cfgs.map((c) => c.id));
    for (const id of [...this.agents.keys()]) {
      if (!want.has(id)) this.agents.delete(id);
    }
    for (const c of cfgs) {
      let a = this.agents.get(c.id);
      if (!a) {
        a = { id: c.id, name: c.name, url: c.url, ok: false, lastOkTs: 0, rows: 0 };
        this.agents.set(c.id, a);
      }
      a.name = c.name;
      if (a.url !== c.url) a.url = c.url;
    }
  }

  async syncAll(): Promise<void> {
    this.reconcile();
    await Promise.all([...this.agents.values()].map((a) => this.syncOne(a)));
  }

  private sinceOf(a: Agent): number {
    return Math.max(this.store.lastTs(a.id), this.stallFloor.get(a.id) ?? 0);
  }

  private async syncOne(a: Agent): Promise<void> {
    try {
      const since = this.sinceOf(a);
      const res = await fetch(`${a.url}/changes?since=${since}&limit=500000`, {
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      // Parse the body ourselves so a truncated/poisoned response is a clear, logged error
      // (res.json() on an empty body only says "Unexpected end of JSON input").
      const text = await res.text();
      let data: { rows?: { n: string; t: number; v: number }[] };
      try {
        data = JSON.parse(text) as { rows?: { n: string; t: number; v: number }[] };
      } catch {
        throw new Error(`bad JSON body (${text.length}B): ${text.slice(0, 120)}`);
      }
      const rows = data.rows ?? [];
      const fresh = rows.filter((r) => r.t > since && Number.isFinite(r.v));
      a.rows = this.store.insert(a.id, fresh);
      a.ok = true;
      a.lastOkTs = Date.now();
      a.lastError = undefined;
      this.failStreak.set(a.id, 0);
      if (!a.hostname || a.hostname === a.id) {
        const h = await fetch(`${a.url}/health`, { signal: AbortSignal.timeout(3000) }).then((r) =>
          r.json()
        );
        a.hostname = h?.hostname ?? undefined;
      }
    } catch (err) {
      a.ok = false;
      a.lastError = (err as Error).message;
      const n = (this.failStreak.get(a.id) ?? 0) + 1;
      this.failStreak.set(a.id, n);
      console.warn(`puller[${a.id}] ${a.url}: ${a.lastError} (fail x${n})`);
      if (n >= 3) void this.tryRecover(a, n).catch(() => {});
    }
  }

  // The agent answers /health even when /changes keeps failing. Read its newest write ts and skip
  // the failing window so the node resumes: a stuck `since` (a poisoned row, or a backlog too large
  // to deliver within the timeout) otherwise freezes that node's data for good.
  private async tryRecover(a: Agent, fails: number): Promise<void> {
    const h = await fetch(`${a.url}/health`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
    const lastWrite = Number((h as { last_write?: number })?.last_write ?? 0);
    const cur = this.sinceOf(a);
    if (lastWrite > cur) {
      this.stallFloor.set(a.id, lastWrite);
      this.failStreak.set(a.id, 0);
      console.warn(
        `puller[${a.id}] ALERT: stuck ${fails} cycles (${a.lastError}); skipping window, resuming at ts=${lastWrite}`
      );
    }
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }
}
