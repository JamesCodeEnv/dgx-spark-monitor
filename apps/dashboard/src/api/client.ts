// Typed API client for the central server.
export interface NodeInfo {
  id: string;
  url: string;
  hostname: string;
  ok: boolean;
  lastOkTs: number;
  rows: number;
}

export type Snapshot = Record<string, number>;
export type AllSnapshots = Record<string, Snapshot>;

export interface Point {
  ts: number;
  val: number;
}

export async function getNodes(): Promise<NodeInfo[]> {
  const r = await fetch('/api/nodes');
  if (!r.ok) throw new Error('nodes');
  const d = (await r.json()) as { agents: NodeInfo[] };
  return d.agents ?? [];
}

export async function getSnapshot(): Promise<AllSnapshots> {
  const r = await fetch('/api/snapshot');
  if (!r.ok) throw new Error('snapshot');
  return (await r.json()) as AllSnapshots;
}

export async function getRange(
  node: string,
  name: string,
  from: number,
  to: number,
  step: number
): Promise<Point[]> {
  const p = new URLSearchParams({ node, name, from: String(from), to: String(to), step: String(step) });
  const r = await fetch(`/api/range?${p}`);
  if (!r.ok) throw new Error(`range ${node}/${name}`);
  const d = (await r.json()) as { points: Point[] };
  return d.points ?? [];
}

export async function getRangeRaw(node: string, name: string): Promise<Point[]> {
  return getRange(node, name, 0, Date.now() / 1000, 0);
}

// ── 配置 CRUD ──
export interface NodeCfg {
  id: string;
  name: string;
  url: string;
  enabled: number;
  ok: boolean;
  hostname?: string;
  rows: number;
  lastOkTs: number;
  series: number;
}

export async function getConfig(): Promise<NodeCfg[]> {
  const r = await fetch('/api/config');
  if (!r.ok) throw new Error('config');
  const d = (await r.json()) as { nodes: NodeCfg[] };
  return d.nodes ?? [];
}

export interface NodeInput {
  id?: string;
  name?: string;
  url?: string;
  enabled?: number;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const r = await fetch(path, init);
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
}

/** Create a node (POST /api/config). `id` is required server-side. */
export async function createNode(cfg: { id: string; name?: string; url: string; enabled?: number }): Promise<void> {
  await request('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: cfg.id,
      name: cfg.name ?? '',
      url: cfg.url,
      enabled: cfg.enabled ?? 1,
    }),
  });
}

/** Partial update of an existing node (PUT /api/config/nodes/:id). */
export async function updateNode(cfg: { id: string } & Omit<NodeInput, 'id'>): Promise<void> {
  await request(`/api/config/nodes/${encodeURIComponent(cfg.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: cfg.name, url: cfg.url, enabled: cfg.enabled }),
  });
}

export async function deleteNode(id: string): Promise<void> {
  await request(`/api/config/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── 集群标签（中控 .env 的 CLUSTER_NAME / SERVED_MODEL）──
export interface Meta {
  cluster: string;
  model: string;
  specPerPos?: boolean;
}

export async function getMeta(): Promise<Meta> {
  const r = await fetch('/api/meta');
  if (!r.ok) throw new Error('meta');
  return (await r.json()) as Meta;
}

// ── 成本（按历史价目 + 峰谷折算；电费=实际支出，token 费用=对外等价节省）──
export interface CostRates { hit: number; miss: number; out: number }
export interface CostDailyRow {
  date: string; prefill: number; hit: number; miss: number; out: number;
  peakCost: number; offPeakCost: number; cost: number;
  kwh: number; powerCost: number; net: number;
}
export interface CostTotals {
  prefill: number; hit: number; miss: number; out: number;
  peakCost: number; offPeakCost: number; cost: number;
  kwh: number; powerCost: number; net: number;
}
export interface CostSchedule {
  effectiveFrom: string; effectiveFromTs: number; effectiveTo: string | null;
  note?: string; hasPeak: boolean; used: boolean; index: number;
  peak: CostRates; offPeak: CostRates;
}
export interface CostPower {
  enabled: boolean; currencySymbol: string; unit: string;
  rate: number; wallFactor: number; nodes: string[];
  samples: number; gaps: number; dataFrom: number; dataTo: number;
}
export interface CostResponse {
  model: string; displayName: string; currency: string; currencySymbol: string;
  unit: string; timezone: string; days: number; from: number; to: number;
  dataFrom: number; dataTo: number;
  daily: CostDailyRow[];
  totals: { today: CostTotals; yesterday: CostTotals; last7: CostTotals; window: CostTotals; all: CostTotals };
  schedules: CostSchedule[];
  sources: { node: string; metrics: string[]; samples: number; resets: number; fallback: boolean; scheduleVersion: number };
  power: CostPower;
}

export async function getCost(days = 30, model?: string): Promise<CostResponse> {
  const p = new URLSearchParams({ days: String(days) });
  if (model) p.set('model', model);
  const r = await fetch(`/api/cost?${p}`);
  if (!r.ok) throw new Error('cost');
  return (await r.json()) as CostResponse;
}

