import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { StatCard } from '../components/StatCard';
import { useCost } from '../api/hooks';
import { fmtTokens, fmtInt, fmtCNY, fmtKWh, fmtX } from '../lib/format';
import { CARD_ROW } from '../lib/layout';
import type { CostSchedule } from '../api/client';

const card: React.CSSProperties = {
  background: '#111720', border: '1px solid #1e2836', borderRadius: 10, padding: 14, minWidth: 0,
};
const th: React.CSSProperties = {
  textAlign: 'right', padding: '6px 10px', color: '#7c8aa0', fontWeight: 500,
  borderBottom: '1px solid #1e2836', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  textAlign: 'right', padding: '6px 10px', color: '#d7dde8', whiteSpace: 'nowrap',
  borderBottom: '1px solid #161d28',
};
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };

const shortDate = (d: string) => d.slice(5); // YYYY-MM-DD → MM-DD

const ratesCell = (s: CostSchedule) => (
  <div style={{ textAlign: 'left', fontSize: 12, color: '#c7d2e4', lineHeight: 1.6 }}>
    <div>空闲：命中 {s.offPeak.hit} · 未命中 {s.offPeak.miss} · 输出 {s.offPeak.out}</div>
    {s.hasPeak
      ? <div>高峰：命中 {s.peak.hit} · 未命中 {s.peak.miss} · 输出 {s.peak.out}</div>
      : <div style={{ color: '#7c8aa0' }}>（无峰谷，全天同价）</div>}
  </div>
);

export function Cost({ days }: { days: number }) {
  const c = useCost(days, 60_000);
  const rangeLabel = days >= 365 ? '全部' : `近${days}天`;

  if (!c) {
    return <div style={{ color: '#7c8aa0', fontSize: 13 }}>加载成本数据中…（首次读取需扫描历史样本，约几秒）</div>;
  }

  const sym = c.currencySymbol;
  const chartData = c.daily.map((d) => ({ ...d, d: shortDate(d.date) }));
  const ratio = c.totals.window.powerCost > 0 ? c.totals.window.cost / c.totals.window.powerCost : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {/* 顶部：口径说明（范围由顶栏「统计范围」统一控制） */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#7c8aa0' }}>
          <b style={{ color: '#e8eef8' }}>{rangeLabel}</b> · {c.displayName} · {c.currency} · {c.timezone} ·
          <b style={{ color: '#ffb74d' }}> 电费=实际支出</b>
          （GPU 功耗 × 整机系数 {c.power.wallFactor} × {c.power.rate} 元/kWh） ·
          <b style={{ color: '#4fc3f7' }}> token 费用=对外等价节省</b>（按官方价折算，我们不花）
        </span>
      </div>

      {/* 支出 / 节省 / 净收益 —— 全部跟随顶栏「统计范围」；今日为固定口径 */}
      <div style={CARD_ROW}>
        <StatCard label="今日电费（实际支出）" value={fmtCNY(c.totals.today.powerCost)} accent="#ffb74d"
          sub={`${fmtKWh(c.totals.today.kwh)} · 近7天 ${fmtCNY(c.totals.last7.powerCost)}`} />
        <StatCard label={`${rangeLabel}电费（实际支出）`} value={fmtCNY(c.totals.window.powerCost)} accent="#ff7043"
          sub={fmtKWh(c.totals.window.kwh)} />
        <StatCard label={`${rangeLabel}等价节省（对外）`} value={fmtCNY(c.totals.window.cost)} accent="#4fc3f7"
          sub="按 DeepSeek 官方价折算" />
        <StatCard label={`${rangeLabel}净收益（节省 − 电费）`} value={fmtCNY(c.totals.window.net)} accent="#6ee7a8"
          sub={ratio !== undefined ? `${fmtX(ratio)} 电费` : '—'} />
        <StatCard label={`${rangeLabel}用电`} value={fmtKWh(c.totals.window.kwh)} accent="#ffb74d"
          sub={`今日 ${fmtKWh(c.totals.today.kwh)}`} />
      </div>

      {/* token 构成：今日（固定口径）在前，所选范围在后 */}
      <div style={CARD_ROW}>
        <StatCard label="今日输入 (prefill)" value={fmtTokens(c.totals.today.prefill)} />
        <StatCard label="今日缓存命中" value={fmtTokens(c.totals.today.hit)} accent="#f0b429"
          sub={c.totals.today.prefill > 0 ? `命中率 ${((c.totals.today.hit / c.totals.today.prefill) * 100).toFixed(1)}%` : undefined} />
        <StatCard label="今日未命中" value={fmtTokens(c.totals.today.miss)} />
        <StatCard label="今日输出" value={fmtTokens(c.totals.today.out)} />
        <StatCard label={`${rangeLabel}输入 (prefill)`} value={fmtTokens(c.totals.window.prefill)} />
        <StatCard label={`${rangeLabel}缓存命中`} value={fmtTokens(c.totals.window.hit)} accent="#f0b429"
          sub={c.totals.window.prefill > 0 ? `命中率 ${((c.totals.window.hit / c.totals.window.prefill) * 100).toFixed(1)}%` : undefined} />
        <StatCard label={`${rangeLabel}未命中`} value={fmtTokens(c.totals.window.miss)} />
        <StatCard label={`${rangeLabel}输出`} value={fmtTokens(c.totals.window.out)} />
      </div>

      {/* 按日：柱=电费（支出），线=等价节省 */}
      <div style={card}>
        <div style={{ fontSize: 13, color: '#c7d2e4', marginBottom: 8 }}>
          按日：<span style={{ color: '#ffb74d' }}>柱=电费（实际支出）</span> vs
          <span style={{ color: '#4fc3f7' }}> 线=等价节省（对外）</span>（{sym}）
        </div>
        {chartData.length === 0
          ? <div style={{ color: '#7c8aa0', fontSize: 12, padding: '30px 0', textAlign: 'center' }}>窗口内暂无数据</div>
          : (
            <ResponsiveContainer width="100%" height={270}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#1a2230" strokeDasharray="3 3" />
                <XAxis dataKey="d" tick={{ fill: '#7c8aa0', fontSize: 11 }} minTickGap={12} />
                <YAxis tick={{ fill: '#7c8aa0', fontSize: 11 }} tickFormatter={(v) => `${sym}${v}`} width={54} />
                <Tooltip
                  contentStyle={{ background: '#0e1320', border: '1px solid #1e2836', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#c7d2e4' }}
                  formatter={(v: number, name: string) => [fmtCNY(v), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="powerCost" name="电费（支出）" fill="#ffb74d" />
                <Line dataKey="cost" name="等价节省（对外）" stroke="#4fc3f7" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
      </div>

      {/* 按日明细 */}
      <div style={{ ...card, overflowX: 'auto' }}>
        <div style={{ fontSize: 13, color: '#c7d2e4', marginBottom: 8 }}>按日明细</div>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>日期</th>
              <th style={th}>prefill</th>
              <th style={th}>命中</th>
              <th style={th}>未命中</th>
              <th style={th}>输出</th>
              <th style={{ ...th, color: '#4fc3f7' }}>节省 {sym}</th>
              <th style={th}>用电</th>
              <th style={{ ...th, color: '#ffb74d' }}>电费 {sym}</th>
              <th style={th}>净收益 {sym}</th>
            </tr>
          </thead>
          <tbody>
            {[...c.daily].reverse().map((d) => (
              <tr key={d.date}>
                <td style={{ ...td, textAlign: 'left' }}>{d.date}</td>
                <td style={td}>{fmtInt(d.prefill)}</td>
                <td style={td}>{fmtInt(d.hit)}</td>
                <td style={td}>{fmtInt(d.miss)}</td>
                <td style={td}>{fmtInt(d.out)}</td>
                <td style={{ ...td, color: '#4fc3f7' }}>{d.cost.toFixed(2)}</td>
                <td style={td}>{fmtKWh(d.kwh)}</td>
                <td style={{ ...td, color: '#ffb74d' }}>{d.powerCost.toFixed(3)}</td>
                <td style={{ ...td, fontWeight: 600, color: d.net >= 0 ? '#6ee7a8' : '#ef5350' }}>{d.net.toFixed(2)}</td>
              </tr>
            ))}
            {c.daily.length === 0 && (
              <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: '#7c8aa0' }}>窗口内暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 电费口径 */}
      <div style={card}>
        <div style={{ fontSize: 13, color: '#c7d2e4', marginBottom: 8 }}>电费口径（实际支出）</div>
        <table style={tableStyle}>
          <tbody>
            <tr>
              <td style={{ ...td, textAlign: 'left', color: '#7c8aa0' }}>电价</td>
              <td style={{ ...td, textAlign: 'left' }}>{c.power.rate} 元/kWh（{c.power.unit}）</td>
              <td style={{ ...td, textAlign: 'left', color: '#7c8aa0' }}>整机系数</td>
              <td style={{ ...td, textAlign: 'left' }}>×{c.power.wallFactor}（GPU → 整机<b style={{ color: '#ffb74d' }}>估算</b>；据本机 idle 36W / 峰值 240W 标定，待实测校准）</td>
            </tr>
            <tr>
              <td style={{ ...td, textAlign: 'left', color: '#7c8aa0' }}>计费节点</td>
              <td style={{ ...td, textAlign: 'left' }}>{c.power.nodes.join('、') || '—'}</td>
              <td style={{ ...td, textAlign: 'left', color: '#7c8aa0' }}>数据自</td>
              <td style={{ ...td, textAlign: 'left' }}>
                {c.power.dataFrom ? new Date(c.power.dataFrom * 1000).toLocaleString('zh-CN') : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* token 价目表（历史） */}
      <div style={card}>
        <div style={{ fontSize: 13, color: '#c7d2e4', marginBottom: 8 }}>
          对外等价价目表（按生效日期；token 按当时生效档折算<b style={{ color: '#4fc3f7' }}>节省</b>，非支出）
        </div>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>生效区间</th>
              <th style={{ ...th, textAlign: 'left' }}>价格（元/百万 token）</th>
              <th style={{ ...th, textAlign: 'left' }}>备注</th>
            </tr>
          </thead>
          <tbody>
            {c.schedules.map((s) => (
              <tr key={s.effectiveFrom}>
                <td style={{ ...td, textAlign: 'left' }}>
                  {s.effectiveFrom.slice(0, 16).replace('T', ' ')}
                  <span style={{ color: '#7c8aa0' }}> → {s.effectiveTo ? s.effectiveTo.slice(0, 16).replace('T', ' ') : '至今'}</span>
                  {s.used && <span style={{ color: '#6ee7a8', marginLeft: 6 }}>● 有使用</span>}
                </td>
                <td style={{ ...td, textAlign: 'left' }}>{ratesCell(s)}</td>
                <td style={{ ...td, textAlign: 'left', color: '#8fa0b8' }}>{s.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 脚注 */}
      <div style={{ fontSize: 12, color: '#7c8aa0', lineHeight: 1.7 }}>
        <b style={{ color: '#ffb74d' }}>实际支出 = 电费</b>：两台机器全天用电（含空载），用 GPU 功耗 × 整机系数折成整机功率后对时间积分得 kWh，再乘电价。系数待用实测墙插功率校准。
        <br />
        <b style={{ color: '#4fc3f7' }}>对外等价节省</b>：同样的 token 若按 DeepSeek 官方价（未命中输入 × 未命中单价 + 输出 × 输出单价，缓存命中单价极低仍计入）要花的钱——我们不花，是省下的。
        <br />
        token 数据节点 <b style={{ color: '#c7d2e4' }}>{c.sources.node}</b>
        （{c.sources.metrics.length} 个指标，{fmtInt(c.sources.samples)} 样本）
        · 计数器归零（引擎重启）跳过 {c.sources.resets} 次
        · 电费样本 {fmtInt(c.power.samples)} 个，掉线缺口 {c.power.gaps} 段（按 0 计）
        {c.sources.fallback && <span style={{ color: '#ffb74d' }}> · 有样本早于首个价目，按最早价目计</span>}
        <br />
        价目表在 <code>data/cost-prices.json</code>（含 <code>power</code> 电费段），改文件后自动热生效（参考 <code>cost-prices.example.json</code>）。
      </div>
    </div>
  );
}
