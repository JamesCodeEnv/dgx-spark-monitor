import { useSnapshot } from '../api/hooks';
import { StatCard } from '../components/StatCard';
import { MetricChart } from '../components/MetricChart';
import { fmt, fmtRate, fmtPct, fmtPctRate, fmtLatency, fmtTokens, fmtInt } from '../lib/format';
import { GRID } from '../lib/layout';
import { pickHead } from '../lib/head';

interface Props {
  win: { sec: number; step: number };
  nodes: string[];
}

export function Overview({ win, nodes }: Props) {
  const snap = useSnapshot(2000);
  const head = pickHead(nodes, snap);
  const headSnap = snap[head] ?? {};

  // ---- 计费累计 token（全集群求和；vLLM 指标只在 head 节点存在）----
  const nodeVals = (name: string) =>
    nodes.map((n) => ({ node: n, v: Number(snap[n]?.[name] ?? 0) })).filter((x) => x.v > 0);
  const sumOf = (name: string) => nodeVals(name).reduce((a, x) => a + x.v, 0);
  const exactOrBreakdown = (name: string) => {
    const parts = nodeVals(name);
    return parts.length > 1
      ? parts.map((x) => `${x.node} ${fmtInt(x.v)}`).join(' · ')
      : parts.length === 1
        ? `精确 ${fmtInt(parts[0].v)}`
        : '暂无数据';
  };
  const prefillTotal = sumOf('vllm.prompt_tok_total');
  const cachedTotal = sumOf('vllm.prompt_cached_total');
  const genTotal = sumOf('vllm.gen_tok_total');
  const billablePrefill = Math.max(0, prefillTotal - cachedTotal); // 未被缓存抵扣、按原价计费的 prefill
  const billableTotal = billablePrefill + genTotal;
  const cachedPct = prefillTotal > 0 ? ((cachedTotal / prefillTotal) * 100).toFixed(1) : null;
  const show = (v: number) => (v > 0 ? fmtTokens(v) : '—');

  const gpuCards = nodes.map((n) => {
    const s = snap[n] ?? {};
    return (
      <StatCard
        key={n}
        label={`GPU ${n}`}
        value={`${fmt(s['host.gpu.util'])}%`}
        sub={`${fmt(s['host.gpu.temp_c'], 0)}°C · ${fmt(s['host.gpu.power_w'], 0)}W`}
        accent={Number(s['host.gpu.util']) > 60 ? '#ffb74d' : undefined}
      />
    );
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatCard label="累计 prefill Token" value={show(prefillTotal)} sub={exactOrBreakdown('vllm.prompt_tok_total')} />
        <StatCard
          label="累计输出 Token"
          value={show(genTotal)}
          sub={exactOrBreakdown('vllm.gen_tok_total')}
          accent="#6ee7a8"
        />
        <StatCard
          label="累计缓存抵扣 Token"
          value={show(cachedTotal)}
          sub={cachedPct ? `占 prefill ${cachedPct}% · 实计 prefill ${fmtTokens(billablePrefill)}` : exactOrBreakdown('vllm.prompt_cached_total')}
          accent="#f0b429"
        />
        <StatCard
          label="计费 Token 合计"
          value={show(billableTotal)}
          sub={`未抵扣 prefill ${fmtTokens(billablePrefill)} + 输出 ${fmtTokens(genTotal)}`}
          accent="#4fc3f7"
        />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatCard label="解码吞吐" value={fmtRate(headSnap['vllm.decode_tok_s'])} />
        <StatCard label="prefill 吞吐" value={fmtRate(headSnap['vllm.prompt_tok_s'])} />
        <StatCard label="显存占用" value={fmtPct(headSnap['host.gpu.mem_used_pct'])} sub={`${fmt(headSnap['host.gpu.mem_used_gb'], 1)} GiB / ${fmt(headSnap['host.gpu.mem_total_gb'], 1)} GB`} />
        <StatCard label="prefix 命中率" value={fmtPctRate(headSnap['vllm.prefix_hit_rate'])} accent="#6ee7a8" />
        <StatCard label="投机接受率" value={fmtPctRate(headSnap['vllm.spec_accept_rate'])} />
        <StatCard label="平均接受长度" value={fmt(headSnap['vllm.spec_accept_len'], 1)} />
        <StatCard label="运行/等待" value={`${fmt(headSnap['vllm.running'], 0)} / ${fmt(headSnap['vllm.waiting'], 0)}`} />
        <StatCard label="TTFT p50" value={fmtLatency(headSnap['vllm.ttft_p50'])} />
        <StatCard label="单token延迟均值" value={fmtLatency(headSnap['vllm.itl_avg_s'])} />
        <StatCard label="Stream 填充/解码" value={`${fmt(headSnap['vllm.num_streams_filling'], 0)} / ${fmt(headSnap['vllm.num_streams_decoding'], 0)}`} accent={Number(headSnap['vllm.num_streams_filling']) > 0 ? '#ffb74d' : undefined} />
        <StatCard label="kept 前缀状态" value={fmt(headSnap['vllm.kept_prompts'], 0)} />
        {gpuCards}
      </div>
      <div style={GRID}>
        <MetricChart
          title="GPU 利用率" unit="%"
          series={nodes.map((n) => ({ node: n, name: 'host.gpu.util' }))}
          window={win} nodes={nodes} refreshMs={10000} height={210}
        />
        <MetricChart
          title="解码吞吐" unit="tok/s"
          series={[{ node: head, name: 'vllm.decode_tok_s', label: 'decode tok/s' }]}
          window={win} nodes={nodes} refreshMs={10000} height={210}
        />
        <MetricChart
          title="显存占用率" unit="%"
          series={[{ node: head, name: 'host.gpu.mem_used_pct' }]}
          window={win} nodes={nodes} refreshMs={10000} height={210}
        />
        <MetricChart
          title="运行/等待请求数" unit="req"
          series={[
            { node: head, name: 'vllm.running', label: 'running', color: '#4fc3f7' },
            { node: head, name: 'vllm.waiting', label: 'waiting', color: '#ffb74d' },
          ]}
          window={win} nodes={nodes} refreshMs={10000} height={210}
        />
      </div>
    </div>
  );
}
