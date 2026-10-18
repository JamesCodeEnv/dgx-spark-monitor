// 成本页：把 token 用量按「当时生效」的价格档 + 峰谷分时折算成费用。
//
// 价格会随时间变化（DeepSeek flash 经历过多次调价 + 峰谷分时），所以价目表按
// 「生效日期」分段：每个 token 增量按它的时间戳选当时生效的那档来计费。
//
// 关键正确性：成本必须由**逐样本增量**累加得出，按 (日, 峰|谷, 价格档) 归类；
// 不能用区间 MAX−MIN（跨窗口会重复计）也不能用 AVG 分桶（对累计计数器无意义）。
// 计数器在引擎重启时会归零 → 负增量按 0 处理（后续增量自然接上）。
import { readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Store } from './store.ts';

export interface Rates {
  hit: number;  // 缓存命中输入（元/百万 token）
  miss: number; // 缓存未命中输入
  out: number;  // 输出
}
export interface Schedule {
  effectiveFrom: string;
  effectiveFromTs: number; // 由 effectiveFrom 解析出的 unix 秒
  note?: string;
  peak: Rates;
  offPeak: Rates;
}
export interface ModelPrices {
  displayName?: string;
  /** 必须按 effectiveFromTs 倒序（最新在前）。 */
  schedules: Schedule[];
}
/** 电费口径：我们自己两台机器的用电（真实支出），与对外等价 API 费用（节省）相对。 */
export interface PowerConfig {
  enabled: boolean;
  currencySymbol: string;
  unit: string;       // 例如 "CNY/kWh"
  rate: number;       // 元/kWh
  /** GPU power.draw → 整机功率 的系数（含 CPU/内存/风扇/电源损耗）；用实测墙插功率校准。 */
  wallFactor: number;
  /** 相邻样本间隔超过此秒数视为 agent 掉线缺口，按 0 计（不 hold-last 高估）。 */
  maxGapS: number;
}
export interface CostFile {
  timezone: string;
  tzOffsetHours: number;
  currency: string;
  currencySymbol: string;
  unit: string; // 例如 "per_1M_tokens"
  defaultModel: string;
  peakHours: { start: string; end: string }[]; // 本地时间半开区间 [start,end)
  models: Record<string, ModelPrices>;
  power: PowerConfig;
}

function sched(effectiveFrom: string, note: string, offPeak: Rates, peak: Rates): Schedule {
  return { effectiveFrom, effectiveFromTs: Math.floor(Date.parse(effectiveFrom) / 1000), note, offPeak, peak };
}

/** 内置默认电费口径：单一电价 0.6 元/kWh。
 * 整机系数 2.8：nvidia-smi 只测 GPU 域；据本机（Dell Pro Max with GB10）
 * 实测 idle 整机 35–37W / GPU ~12W（≈3.0）与整机峰值 240W / GPU 峰值 ~88W（≈2.7）取 2.8。
 * 待用插座实测校准。 */
export const DEFAULT_POWER: PowerConfig = {
  enabled: true,
  currencySymbol: '¥',
  unit: 'CNY/kWh',
  rate: 0.6,
  wallFactor: 2.8,
  maxGapS: 120,
};

/** 内置默认价目（deepseek-v4-flash，人民币）——自动 seed 到文件、也是坏文件的回退。 */
export const DEFAULT_COST_PRICES: CostFile = {
  timezone: 'Asia/Shanghai',
  tzOffsetHours: 8,
  currency: 'CNY',
  currencySymbol: '¥',
  unit: 'per_1M_tokens',
  defaultModel: 'deepseek-v4-flash',
  peakHours: [
    { start: '09:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ],
  models: {
    'deepseek-v4-flash': {
      displayName: 'DeepSeek-V4.1-Flash',
      schedules: [
        sched('2026-09-10T12:00:00+08:00', '2026-09-10 12:00 降价后',
          { hit: 0.02, miss: 1.0, out: 4.0 }, { hit: 0.04, miss: 2.0, out: 8.0 }),
        sched('2026-08-17T00:00:00+08:00', '2026-08-17 起引入高峰/空闲（峰谷）',
          { hit: 0.05, miss: 1.5, out: 4.5 }, { hit: 0.10, miss: 3.0, out: 9.0 }),
        sched('1970-01-01T00:00:00+08:00', '2026-08-17 前单一价（无峰谷）',
          { hit: 0.02, miss: 1.0, out: 2.0 }, { hit: 0.02, miss: 1.0, out: 2.0 }),
      ],
    },
  },
  power: DEFAULT_POWER,
};

function hhmm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

function isRates(r: unknown): r is Rates {
  const x = r as Rates;
  return !!x && Number.isFinite(x.hit) && Number.isFinite(x.miss) && Number.isFinite(x.out);
}

/** 宽松校验 + 规整（补默认、算 effectiveFromTs、按时间倒序）。不合法返回 null。 */
function normalize(raw: unknown): CostFile | null {
  const f = raw as Partial<CostFile>;
  if (!f || typeof f !== 'object' || !f.models || typeof f.models !== 'object') return null;
  const p = (f.power ?? {}) as Partial<PowerConfig>;
  const out: CostFile = {
    timezone: f.timezone ?? DEFAULT_COST_PRICES.timezone,
    tzOffsetHours: Number.isFinite(f.tzOffsetHours) ? Number(f.tzOffsetHours) : DEFAULT_COST_PRICES.tzOffsetHours,
    currency: f.currency ?? 'CNY',
    currencySymbol: f.currencySymbol ?? '¥',
    unit: f.unit ?? 'per_1M_tokens',
    defaultModel: f.defaultModel ?? Object.keys(f.models)[0] ?? DEFAULT_COST_PRICES.defaultModel,
    peakHours: Array.isArray(f.peakHours) && f.peakHours.length ? f.peakHours : DEFAULT_COST_PRICES.peakHours,
    models: {},
    power: {
      enabled: p.enabled !== false,
      currencySymbol: p.currencySymbol ?? DEFAULT_POWER.currencySymbol,
      unit: p.unit ?? DEFAULT_POWER.unit,
      rate: Number.isFinite(p.rate) ? Number(p.rate) : DEFAULT_POWER.rate,
      wallFactor: Number.isFinite(p.wallFactor) ? Number(p.wallFactor) : DEFAULT_POWER.wallFactor,
      maxGapS: Number.isFinite(p.maxGapS) ? Number(p.maxGapS) : DEFAULT_POWER.maxGapS,
    },
  };
  for (const [key, def] of Object.entries(f.models as Record<string, ModelPrices>)) {
    if (!def || !Array.isArray(def.schedules) || !def.schedules.length) continue;
    const scheds: Schedule[] = [];
    for (const s of def.schedules) {
      if (!s || !s.effectiveFrom || !isRates(s.peak) || !isRates(s.offPeak)) continue;
      const ts = Number.isFinite(s.effectiveFromTs)
        ? Number(s.effectiveFromTs)
        : Math.floor(Date.parse(String(s.effectiveFrom)) / 1000);
      if (!Number.isFinite(ts)) continue;
      scheds.push({ effectiveFrom: String(s.effectiveFrom), effectiveFromTs: ts, note: s.note, peak: s.peak, offPeak: s.offPeak });
    }
    if (!scheds.length) continue;
    scheds.sort((a, b) => b.effectiveFromTs - a.effectiveFromTs); // 最新在前
    out.models[key] = { displayName: def.displayName, schedules: scheds };
  }
  return Object.keys(out.models).length ? out : null;
}

/** 价目表加载器：文件热读取（mtime 变化即重载），坏文件回退内置默认。 */
export class CostPrices {
  private cached: CostFile = DEFAULT_COST_PRICES;
  private mtime = 0;
  private path: string;
  constructor(path: string) {
    this.path = path;
    try {
      mkdirSync(dirname(path), { recursive: true });
      if (!existsSync(path)) writeFileSync(path, JSON.stringify(DEFAULT_COST_PRICES, null, 2) + '\n', 'utf8');
    } catch (e) {
      console.warn(`[cost] 无法写入价目文件 ${path}: ${(e as Error).message}`);
    }
    this.reload();
  }

  private reload(): void {
    try {
      const st = statSync(this.path);
      if (st.mtimeMs === this.mtime) return;
      const parsed = normalize(JSON.parse(readFileSync(this.path, 'utf8')));
      if (!parsed) throw new Error('结构不合法');
      this.cached = parsed;
      this.mtime = st.mtimeMs;
    } catch (e) {
      if (this.mtime !== 0 || existsSync(this.path)) {
        console.warn(`[cost] 价目文件不可用，回退内置默认: ${(e as Error).message}`);
      }
      this.cached = DEFAULT_COST_PRICES;
      this.mtime = 0;
    }
  }

  file(): CostFile { this.reload(); return this.cached; }
  /** 文件 mtime（用于缓存失效）；内置默认时为 0。 */
  version(): number { this.reload(); return this.mtime; }

  /** 显式给了未知模型名 → undefined（调用方报错）；未给 → defaultModel。 */
  model(name?: string): { key: string; def: ModelPrices } | undefined {
    const f = this.cached;
    const key = name ?? f.defaultModel;
    const def = f.models[key];
    return def ? { key, def } : undefined;
  }
  /** 选时间戳 ts 生效的价格档；早于最早档时返回最早档并标记 fallback。 */
  scheduleAt(key: string, ts: number): { schedule: Schedule; index: number; fallback: boolean } | undefined {
    const ss = this.cached.models[key]?.schedules;
    if (!ss || !ss.length) return undefined;
    const last = ss.length - 1;
    if (ts < ss[last].effectiveFromTs) return { schedule: ss[last], index: last, fallback: true };
    const i = ss.findIndex((s) => s.effectiveFromTs <= ts);
    return { schedule: ss[i < 0 ? 0 : i], index: i < 0 ? 0 : i, fallback: false };
  }
  /** 本地(+tzOffsetHours) 日期 "YYYY-MM-DD"。 */
  dayKey(ts: number): string {
    return new Date((ts + this.cached.tzOffsetHours * 3600) * 1000).toISOString().slice(0, 10);
  }
  isPeak(ts: number): boolean {
    const tz = this.cached.tzOffsetHours * 3600;
    const sod = (((ts + tz) % 86400) + 86400) % 86400;
    return this.cached.peakHours.some((w) => sod >= hhmm(w.start) && sod < hhmm(w.end));
  }
}

// ---- 计费 ----

export const COST_METRICS = {
  prompt: 'vllm.prompt_tok_total',
  cached: 'vllm.prompt_cached_total',
  gen: 'vllm.gen_tok_total',
} as const;
/** 电费来源：agent 采集的 GPU 功耗（gauge，瓦），两台节点都要。 */
export const POWER_METRIC = 'host.gpu.power_w';
type Field = keyof typeof COST_METRICS;
const FIELD_OF: Record<string, Field> = {
  [COST_METRICS.prompt]: 'prompt',
  [COST_METRICS.cached]: 'cached',
  [COST_METRICS.gen]: 'gen',
};

interface Tok { prompt: number; cached: number; gen: number }

export interface CostDailyRow {
  date: string;
  prefill: number; // 总输入
  hit: number;     // 缓存命中输入
  miss: number;    // 未命中输入 = prefill − hit
  out: number;     // 输出
  peakCost: number;    // 等价 API 节省（高峰时段）
  offPeakCost: number; // 等价 API 节省（空闲时段）
  cost: number;        // 等价 API 节省合计
  kwh: number;         // 用电量（整机估算）
  powerCost: number;   // 电费（实际支出）
  net: number;         // 净收益 = cost − powerCost
}
export interface CostTotals {
  prefill: number; hit: number; miss: number; out: number;
  peakCost: number; offPeakCost: number; cost: number;
  kwh: number; powerCost: number; net: number;
}
export interface CostScheduleOut extends Schedule {
  index: number;
  effectiveTo: string | null;
  hasPeak: boolean;
  used: boolean;
}

function priceTok(t: Tok, r: Rates): number {
  return (t.cached / 1e6) * r.hit
    + (Math.max(0, t.prompt - t.cached) / 1e6) * r.miss
    + (t.gen / 1e6) * r.out;
}

interface CostCompute {
  model: string;
  displayName: string;
  currency: string;
  currencySymbol: string;
  unit: string;
  timezone: string;
  dataFrom: number;
  dataTo: number;
  byDate: Map<string, CostDailyRow>;
  schedules: CostScheduleOut[];
  sources: { node: string; metrics: string[]; samples: number; resets: number; fallback: boolean; scheduleVersion: number };
}

const EMPTY_ROW = (date: string): CostDailyRow => ({
  date, prefill: 0, hit: 0, miss: 0, out: 0,
  peakCost: 0, offPeakCost: 0, cost: 0, kwh: 0, powerCost: 0, net: 0,
});

let tokenCache: { key: string; at: number; compute: CostCompute } | null = null;
let powerCache: { key: string; at: number; compute: PowerCompute } | null = null;
const CACHE_TTL_MS = 30_000;

function computeAll(store: Store, prices: CostPrices, node: string, key: string, now: number): CostCompute {
  const f = prices.file();
  const def = f.models[key];
  const scheds = def.schedules;
  const buckets = new Map<string, { day: string; peak: boolean; schedIdx: number; tok: Tok }>();
  let samples = 0, resets = 0, fallback = false, dataFrom = Infinity, dataTo = 0;

  for (const [field, name] of Object.entries(COST_METRICS) as [Field, string][]) {
    const rows = store.raw(node, [name], 0, Math.floor(now));
    samples += rows.length;
    let has = false, prev = 0;
    for (const r of rows) {
      const v = r.val;
      if (!Number.isFinite(v)) continue;
      if (has) {
        let d = v - prev;
        if (d < 0) { d = 0; resets++; } // 引擎重启：跳过负增量
        if (d > 0) {
          const sa = prices.scheduleAt(key, r.ts);
          if (sa) {
            if (sa.fallback) fallback = true;
            const day = prices.dayKey(r.ts);
            const peak = prices.isPeak(r.ts);
            const bk = `${day}|${peak ? 1 : 0}|${sa.index}`;
            let b = buckets.get(bk);
            if (!b) { b = { day, peak, schedIdx: sa.index, tok: { prompt: 0, cached: 0, gen: 0 } }; buckets.set(bk, b); }
            b.tok[field] += d;
          }
        }
      }
      has = true;
      prev = v;
      if (r.ts < dataFrom) dataFrom = r.ts;
      if (r.ts > dataTo) dataTo = r.ts;
    }
  }

  const byDate = new Map<string, CostDailyRow>();
  const usedIdx = new Set<number>();
  for (const b of buckets.values()) {
    const s = scheds[b.schedIdx];
    if (!s) continue;
    usedIdx.add(b.schedIdx);
    const cost = priceTok(b.tok, b.peak ? s.peak : s.offPeak);
    let row = byDate.get(b.day);
    if (!row) { row = EMPTY_ROW(b.day); byDate.set(b.day, row); }
    row.prefill += b.tok.prompt;
    row.hit += b.tok.cached;
    row.out += b.tok.gen;
    row.cost += cost;
    if (b.peak) row.peakCost += cost; else row.offPeakCost += cost;
  }
  for (const row of byDate.values()) row.miss = Math.max(0, row.prefill - row.hit);

  const schedules: CostScheduleOut[] = scheds.map((s, i) => ({
    ...s,
    index: i,
    effectiveTo: i === 0 ? null : scheds[i - 1].effectiveFrom,
    hasPeak: s.peak.hit !== s.offPeak.hit || s.peak.miss !== s.offPeak.miss || s.peak.out !== s.offPeak.out,
    used: usedIdx.has(i),
  }));

  return {
    model: key,
    displayName: def.displayName ?? key,
    currency: f.currency,
    currencySymbol: f.currencySymbol,
    unit: f.unit,
    timezone: `UTC+${f.tzOffsetHours}`,
    dataFrom: Number.isFinite(dataFrom) ? dataFrom : 0,
    dataTo,
    byDate,
    schedules,
    sources: {
      node,
      metrics: Object.values(COST_METRICS),
      samples,
      resets,
      fallback,
      scheduleVersion: prices.version(),
    },
  };
}

interface PowerDailyRow { date: string; kwh: number }
export interface PowerCompute {
  enabled: boolean;
  currencySymbol: string;
  unit: string;
  rate: number;
  wallFactor: number;
  nodes: string[];
  samples: number;
  gaps: number;
  dataFrom: number;
  dataTo: number;
  byDate: Map<string, PowerDailyRow>;
}

/**
 * 电费：把我们自己的用电积成 kWh。GPU power.draw 是**瞬时功率（gauge）**，
 * 所以用相邻样本的时间加权（梯形）积分，逐节点求和；间隔超过 maxGapS 视为
 * agent 掉线缺口 → 该区间按 0（不 hold-last 高估）。归桶到 ts 所在本地日。
 */
function computePower(store: Store, prices: CostPrices, nodes: string[], now: number): PowerCompute {
  const pc = prices.file().power;
  const byDate = new Map<string, PowerDailyRow>();
  let samples = 0, gaps = 0, dataFrom = Infinity, dataTo = 0;
  const to = Math.floor(now);

  if (pc.enabled) {
    for (const node of nodes) {
      const rows = store.raw(node, [POWER_METRIC], 0, to);
      samples += rows.length;
      let has = false, prevT = 0, prevV = 0;
      for (const r of rows) {
        const v = r.val;
        if (!Number.isFinite(v)) { has = false; continue; } // 坏样本断开，不跨桥
        if (has) {
          const dt = r.ts - prevT;
          if (dt > 0 && dt <= pc.maxGapS) {
            const kwh = (((prevV + v) / 2) * pc.wallFactor) * dt / 3.6e6;
            if (kwh > 0) {
              const day = prices.dayKey(r.ts);
              let row = byDate.get(day);
              if (!row) { row = { date: day, kwh: 0 }; byDate.set(day, row); }
              row.kwh += kwh;
            }
          } else if (dt > pc.maxGapS) {
            gaps++;
          }
        }
        has = true; prevT = r.ts; prevV = v;
        if (r.ts < dataFrom) dataFrom = r.ts;
        if (r.ts > dataTo) dataTo = r.ts;
      }
    }
  }

  return {
    enabled: pc.enabled,
    currencySymbol: pc.currencySymbol,
    unit: pc.unit,
    rate: pc.rate,
    wallFactor: pc.wallFactor,
    nodes,
    samples,
    gaps,
    dataFrom: Number.isFinite(dataFrom) ? dataFrom : 0,
    dataTo,
    byDate,
  };
}

function enumerateDates(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  const to = Date.parse(toKey + 'T00:00:00Z');
  for (let t = Date.parse(fromKey + 'T00:00:00Z'); t <= to; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function sumRows(rows: CostDailyRow[]): CostTotals {
  const t: CostTotals = { prefill: 0, hit: 0, miss: 0, out: 0, peakCost: 0, offPeakCost: 0, cost: 0, kwh: 0, powerCost: 0, net: 0 };
  for (const r of rows) {
    t.prefill += r.prefill; t.hit += r.hit; t.miss += r.miss; t.out += r.out;
    t.peakCost += r.peakCost; t.offPeakCost += r.offPeakCost; t.cost += r.cost;
    t.kwh += r.kwh; t.powerCost += r.powerCost; t.net += r.net;
  }
  return t;
}

/** 电费元信息（对外）。 */
export interface PowerPayload {
  enabled: boolean;
  currencySymbol: string;
  unit: string;
  rate: number;
  wallFactor: number;
  nodes: string[];
  samples: number;
  gaps: number;
  dataFrom: number;
  dataTo: number;
}

/** 对外响应（不含内部 byDate）。 */
export interface CostPayload {
  model: string;
  displayName: string;
  currency: string;
  currencySymbol: string;
  unit: string;
  timezone: string;
  dataFrom: number;
  dataTo: number;
  days: number;
  from: number;
  to: number;
  daily: CostDailyRow[];
  totals: { today: CostTotals; yesterday: CostTotals; last7: CostTotals; window: CostTotals; all: CostTotals };
  schedules: CostScheduleOut[];
  sources: CostCompute['sources'];
  power: PowerPayload;
}

export function buildCostResponse(
  store: Store,
  prices: CostPrices,
  node: string,
  modelName: string | undefined,
  days: number,
  now: number,
  powerNodes: string[] = []
): CostPayload | { error: string } {
  const m = prices.model(modelName);
  if (!m) return { error: `未知模型 ${modelName ?? ''}` };
  const cacheKey = `${node}|${m.key}|${prices.version()}`;
  if (!tokenCache || tokenCache.key !== cacheKey || Date.now() - tokenCache.at > CACHE_TTL_MS) {
    tokenCache = { key: cacheKey, at: Date.now(), compute: computeAll(store, prices, node, m.key, now) };
  }
  const c = tokenCache.compute;

  const powerKey = `${powerNodes.join(',')}|${prices.version()}`;
  if (!powerCache || powerCache.key !== powerKey || Date.now() - powerCache.at > CACHE_TTL_MS) {
    powerCache = { key: powerKey, at: Date.now(), compute: computePower(store, prices, powerNodes, now) };
  }
  const pw = powerCache.compute;

  // 合并：token（等价 API 节省）+ 电费（实际支出），逐日算 net = 节省 − 电费。
  const merged = new Map<string, CostDailyRow>();
  for (const [d, r] of c.byDate) merged.set(d, { ...r });
  for (const [d, p] of pw.byDate) {
    const cost = p.kwh * pw.rate;
    const r = merged.get(d);
    if (r) { r.kwh = p.kwh; r.powerCost = cost; }
    else merged.set(d, { ...EMPTY_ROW(d), kwh: p.kwh, powerCost: cost });
  }
  for (const r of merged.values()) r.net = r.cost - r.powerCost;

  const dataFromAll = Math.min(c.dataFrom > 0 ? c.dataFrom : Infinity, pw.dataFrom > 0 ? pw.dataFrom : Infinity);
  const dataToAll = Math.max(c.dataTo, pw.dataTo);

  const nowSec = Math.floor(now);
  const todayKey = prices.dayKey(nowSec);
  const yKey = prices.dayKey(nowSec - 86_400);
  const last7Start = prices.dayKey(nowSec - 6 * 86_400);
  // The selected range is the headline 口径: `window` is what the cards show, `all` stays as the
  // whole record for the "全部" comparison. `fromKey` must be known before the totals are summed.
  const clampedDays = Math.max(1, Math.min(365, Math.floor(days) || 30));
  const fromKey = prices.dayKey(nowSec - (clampedDays - 1) * 86_400);
  const allRows = [...merged.values()];
  const windowRows = allRows.filter((r) => r.date >= fromKey && r.date <= todayKey);
  const totals = {
    today: sumRows(merged.has(todayKey) ? [merged.get(todayKey)!] : []),
    yesterday: sumRows(merged.has(yKey) ? [merged.get(yKey)!] : []),
    last7: sumRows(allRows.filter((r) => r.date >= last7Start && r.date <= todayKey)),
    window: sumRows(windowRows),
    all: sumRows(allRows),
  };

  const fromDataKey = prices.dayKey(Number.isFinite(dataFromAll) ? dataFromAll : nowSec);
  const startKey = dataToAll > 0 && fromKey < fromDataKey ? fromDataKey : fromKey;
  const daily: CostDailyRow[] = dataToAll > 0
    ? enumerateDates(startKey, todayKey).map((d) => merged.get(d) ?? EMPTY_ROW(d))
    : [];

  return {
    model: c.model,
    displayName: c.displayName,
    currency: c.currency,
    currencySymbol: c.currencySymbol,
    unit: c.unit,
    timezone: c.timezone,
    dataFrom: Number.isFinite(dataFromAll) ? dataFromAll : 0,
    dataTo: dataToAll,
    schedules: c.schedules,
    sources: c.sources,
    power: {
      enabled: pw.enabled,
      currencySymbol: pw.currencySymbol,
      unit: pw.unit,
      rate: pw.rate,
      wallFactor: pw.wallFactor,
      nodes: pw.nodes,
      samples: pw.samples,
      gaps: pw.gaps,
      dataFrom: pw.dataFrom,
      dataTo: pw.dataTo,
    },
    days: clampedDays,
    from: Date.parse(fromKey + 'T00:00:00Z') / 1000,
    to: nowSec,
    daily,
    totals,
  };
}
