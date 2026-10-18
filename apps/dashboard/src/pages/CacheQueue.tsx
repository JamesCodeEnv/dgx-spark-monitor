import { MetricChart } from '../components/MetricChart';
import { useSnapshot } from '../api/hooks';
import { StatCard } from '../components/StatCard';
import { fmt, fmtPct, fmtPctRate } from '../lib/format';
import { GRID } from '../lib/layout';
import { pickHead } from '../lib/head';

interface Props {
  win: { sec: number; step: number };
  nodes: string[];
}

export function CacheQueue({ win, nodes }: Props) {
  const snap = useSnapshot(2000);
  const head = pickHead(nodes, snap);
  const s = snap[head] ?? {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatCard label="prefix 命中率" value={fmtPctRate(s['vllm.prefix_hit_rate'])} accent="#6ee7a8" />
        <StatCard label="prefill 缓存占比" value={fmtPct(s['vllm.prompt_cached_pct'])} accent="#6ee7a8" />
        <StatCard label="显存占用" value={fmtPct(s['host.gpu.mem_used_pct'])} sub={`${fmt(s['host.gpu.mem_used_gb'], 1)} GiB / ${fmt(s['host.gpu.mem_total_gb'], 1)} GB`} />
        <StatCard label="运行中请求" value={String(s['vllm.running'] ?? '—')} />
        <StatCard label="等待请求" value={String(s['vllm.waiting'] ?? '—')} />
        <StatCard label="Stream 填充中" value={String(s['vllm.num_streams_filling'] ?? 0)} accent={Number(s['vllm.num_streams_filling']) > 0 ? '#ffb74d' : undefined} />
        <StatCard label="kept 前缀状态" value={String(s['vllm.kept_prompts'] ?? '—')} sub="TensorFold 无抢占指标" />
      </div>
      <div style={GRID}>
        <MetricChart title="prefix 命中率" unit="%" series={[{ node: head, name: 'vllm.prefix_hit_rate', label: '命中率', scale: 100 }]} window={win} nodes={nodes} refreshMs={15000} />
        <MetricChart title="prefill 缓存占比" unit="%" series={[{ node: head, name: 'vllm.prompt_cached_pct', label: 'cached%' }]} window={win} nodes={nodes} refreshMs={15000} />
        <MetricChart title="显存占用率" unit="%" series={[{ node: head, name: 'host.gpu.mem_used_pct', label: '显存%' }]} window={win} nodes={nodes} refreshMs={15000} />
        <MetricChart title="运行/等待" unit="req" series={[{ node: head, name: 'vllm.running', label: 'running' }, { node: head, name: 'vllm.waiting', label: 'waiting' }]} window={win} nodes={nodes} refreshMs={15000} />
        <MetricChart title="Stream 状态" unit="req" series={[{ node: head, name: 'vllm.num_streams_filling', label: '填充中', color: '#ffb74d' }, { node: head, name: 'vllm.num_streams_decoding', label: '解码中', color: '#4fc3f7' }, { node: head, name: 'vllm.num_streams_prefilling', label: '预填充' }]} window={win} nodes={nodes} refreshMs={15000} />
        <MetricChart title="prefix 命中/查询累计" unit="" series={[{ node: head, name: 'vllm.prefix_hits_total', label: 'hits' }, { node: head, name: 'vllm.prefix_queries_total', label: 'queries' }]} window={win} nodes={nodes} refreshMs={15000} />
      </div>
    </div>
  );
}
