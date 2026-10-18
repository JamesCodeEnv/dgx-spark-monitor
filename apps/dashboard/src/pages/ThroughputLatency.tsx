import { MetricChart } from '../components/MetricChart';
import { GRID } from '../lib/layout';
import { useSnapshot } from '../api/hooks';
import { pickHead } from '../lib/head';

interface Props {
  win: { sec: number; step: number };
  nodes: string[];
}

export function ThroughputLatency({ win, nodes }: Props) {
  const snap = useSnapshot(2000);
  const head = pickHead(nodes, snap);
  return (
    <div style={GRID}>
      <MetricChart title="引擎总输出（每秒）" unit="tok/s"
        series={[{ node: head, name: 'vllm.decode_tok_s', label: '总输出' }]}
        window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="Prefill 吞吐 (实计, 扣缓存)" unit="tok/s" series={[{ node: head, name: 'vllm.prompt_tok_s', label: 'prefill' }]} window={win} nodes={nodes} refreshMs={15000} />
      <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#7c8aa0' }}>
        prefill 只统计未命中缓存、真正计算的 prompt token（TF 无 engine-step/ITL 指标，相关线已移除）；空闲或纯缓存命中时为 0，大 prompt 灌入时出现尖峰（可到数万 tok/s）。
      </div>
      <MetricChart title="TTFT" unit="s" series={[{ node: head, name: 'vllm.ttft_p50', label: 'p50' }, { node: head, name: 'vllm.ttft_p90', label: 'p90' }, { node: head, name: 'vllm.ttft_p99', label: 'p99' }]} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="单 token 延迟（均值）" unit="s" series={[{ node: head, name: 'vllm.itl_avg_s', label: '均值' }]} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="端到端延迟" unit="s" series={[{ node: head, name: 'vllm.e2e_p50', label: 'p50' }, { node: head, name: 'vllm.e2e_p90', label: 'p90' }, { node: head, name: 'vllm.e2e_p99', label: 'p99' }]} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="kept 前缀 / 草稿轮次" unit="" series={[{ node: head, name: 'vllm.kept_prompts', label: 'kept 状态' }, { node: head, name: 'vllm.rounds_total', label: '草稿轮次' }]} window={win} nodes={nodes} refreshMs={15000} />
      <MetricChart title="累计 token" unit="" series={[{ node: head, name: 'vllm.gen_tok_total', label: 'generation' }, { node: head, name: 'vllm.prompt_tok_total', label: 'prompt' }]} window={win} nodes={nodes} refreshMs={15000} />
      <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#7c8aa0' }}>
        延迟指标来自 vLLM 的直方图分位数（每采集周期一次），单位秒；吞吐为采集窗口内的增量速率。
      </div>
    </div>
  );
}
