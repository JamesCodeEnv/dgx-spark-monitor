import { MetricChart } from '../components/MetricChart';
import { useSnapshot } from '../api/hooks';
import { StatCard } from '../components/StatCard';
import { fmt, fmtInt, fmtPct } from '../lib/format';
import { GRID } from '../lib/layout';
import { pickHead } from '../lib/head';

interface Props {
  win: { sec: number; step: number };
  nodes: string[];
}

// LMCache SSD cold-backup panel.
// Series come from dspark-agent --lmcache <server:8080> (server-wide metrics only).
export function LMCache({ win, nodes }: Props) {
  const snap = useSnapshot(2000);
  const head = pickHead(nodes, snap);
  const s = snap[head] ?? {};

  const l2 = s['lmcache.l2_used_gb'] ?? 0;
  const dropped = s['lmcache.event_dropped_total'] ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ padding: '10px 14px', border: '1px solid #b58900', borderRadius: 8, background: 'rgba(181,137,0,.12)', fontSize: 13 }}>
        ⚠️ 当前推理栈为 <b>TensorFold（GLM-5.3）</b>，未运行 LMCache——本页为 DeepSeek vLLM 栈的遗留面板，数据不会更新。
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatCard
          label="lookup 命中率（累计）"
          value={fmtPct(s['lmcache.lookup_hit_pct_total'])}
          sub={`窗口 ${fmtPct(s['lmcache.lookup_hit_pct'])}`}
          accent="#6ee7a8"
        />
        <StatCard
          label="L1 使用率"
          value={fmtPct(s['lmcache.l1_usage_pct'])}
          sub={`${fmt(s['lmcache.l1_used_gb'], 2)} GiB / 1 GiB staging`}
        />
        <StatCard
          label="L2 SSD 用量"
          value={`${fmt(l2, 1)} GiB`}
          sub={`${((l2 / 500) * 100).toFixed(1)}% / 500 GiB 上限`}
        />
        <StatCard
          label="SSD 命中 chunk"
          value={fmtInt(s['lmcache.ssd_hit_chunks_total'])}
          sub={`已回读 ${fmtInt(s['lmcache.chunks_retrieved_total'])}`}
          accent="#4fc3f7"
        />
        <StatCard label="写入 SSD chunk" value={fmtInt(s['lmcache.chunks_stored_total'])} />
        <StatCard
          label="L1 淘汰 / 事件丢弃"
          value={`${fmtInt(s['lmcache.l1_evicted_chunks_total'])} / ${fmtInt(dropped)}`}
          accent={dropped > 0 ? '#ef5350' : undefined}
        />
      </div>

      <div style={GRID}>
        <MetricChart
          title="lookup 命中率（窗口）"
          unit="%"
          series={[{ name: 'lmcache.lookup_hit_pct', label: '窗口命中率' }]}
          window={win}
          nodes={nodes}
          refreshMs={15000}
        />
        <MetricChart
          title="lookup 命中率（累计）"
          unit="%"
          series={[{ name: 'lmcache.lookup_hit_pct_total', label: '累计命中率' }]}
          window={win}
          nodes={nodes}
          refreshMs={15000}
        />
        <MetricChart
          title="SSD 写入 / 回读速率"
          unit="chunk/s"
          series={[
            { name: 'lmcache.store_chunk_s', label: '写入 SSD' },
            { name: 'lmcache.retrieve_chunk_s', label: 'SSD→GPU' },
          ]}
          window={win}
          nodes={nodes}
          refreshMs={15000}
        />
        <MetricChart
          title="L1 读写速率"
          unit="chunk/s"
          series={[
            { name: 'lmcache.l1_write_chunk_s', label: 'L1 写' },
            { name: 'lmcache.l1_read_chunk_s', label: 'L1 读' },
          ]}
          window={win}
          nodes={nodes}
          refreshMs={15000}
        />
        <MetricChart
          title="L2 SSD 用量"
          unit="GiB"
          series={[{ name: 'lmcache.l2_used_gb', label: 'L2 用量' }]}
          window={win}
          nodes={nodes}
          refreshMs={15000}
        />
        <MetricChart
          title="L1 staging 使用率"
          unit="%"
          series={[{ name: 'lmcache.l1_usage_pct', label: 'L1 使用率' }]}
          window={win}
          nodes={nodes}
          refreshMs={15000}
          yDomain={[0, 100]}
        />
        <MetricChart
          title="累计 chunk（写入 / 回读 / SSD 命中）"
          unit="chunk"
          series={[
            { node: head, name: 'lmcache.chunks_stored_total', label: '写入 SSD' },
            { node: head, name: 'lmcache.chunks_retrieved_total', label: '回读' },
            { node: head, name: 'lmcache.ssd_hit_chunks_total', label: 'SSD 命中' },
          ]}
          window={win}
          nodes={nodes}
          refreshMs={15000}
        />
        <MetricChart
          title="lookup token 速率"
          unit="tok/s"
          series={[
            { name: 'lmcache.lookup_tokens_s', label: '查询' },
            { name: 'lmcache.hit_tokens_s', label: '命中' },
          ]}
          window={win}
          nodes={nodes}
          refreshMs={15000}
        />
      </div>
    </div>
  );
}
