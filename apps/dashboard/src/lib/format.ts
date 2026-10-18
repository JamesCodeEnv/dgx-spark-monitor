export const fmt = (v: number | undefined, digits = 1): string =>
  v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits);

// format a seconds value as ms when tiny, else seconds
const s2s = (v: number): string => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`);

export const fmtLatency = (v: number | undefined): string =>
  v === undefined || Number.isNaN(v) || v === 0 ? '—' : s2s(v);

export const fmtRate = (v: number | undefined): string =>
  v === undefined ? '—' : `${v.toFixed(1)} tok/s`;

export const fmtPct = (v: number | undefined): string =>
  v === undefined || Number.isNaN(v) ? '—' : `${v.toFixed(1)}%`;

// fmtPctRate: vLLM `*_rate` 系列存的是 0-1 分数（如 0.96），展示成百分比需 ×100。
export const fmtPctRate = (v: number | undefined): string =>
  v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(1)}%`;

// fmtTokens: 累计 token 大数紧凑格式（574706827 → "574.71M"），用于计费累计卡。
export const fmtTokens = (v: number | undefined): string => {
  if (v === undefined || Number.isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
};

// fmtInt: 千分位精确整数（计费口径的精确 token 数）。
export const fmtInt = (v: number | undefined): string =>
  v === undefined || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('en-US');

// fmtCNY: 成本金额（元）。≥1 元保留 2 位，小额保留 4 位以保留区分度。
export const fmtCNY = (v: number | undefined): string => {
  if (v === undefined || Number.isNaN(v)) return '—';
  return Math.abs(v) >= 1 ? `¥${v.toFixed(2)}` : `¥${v.toFixed(4)}`;
};

// fmtKWh: 用电量（千瓦时）。≥100 → 整数，≥1 → 2 位，小额 3 位。
export const fmtKWh = (v: number | undefined): string => {
  if (v === undefined || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 100) return `${v.toFixed(0)} kWh`;
  if (a >= 1) return `${v.toFixed(2)} kWh`;
  return `${v.toFixed(3)} kWh`;
};

// fmtX: 倍数（如 节省÷电费）。≥10 不保留小数，否则 1 位。
export const fmtX = (v: number | undefined): string => {
  if (v === undefined || !Number.isFinite(v)) return '—';
  return `×${Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)}`;
};

export const fmtBytesHR = (v: number | undefined): string => {
  if (v === undefined || Number.isNaN(v) || v <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
};

export const timeLabel = (tsSec: number): string =>
  new Date(tsSec * 1000).toLocaleTimeString('zh-CN', { hour12: false });
