import { MetricChart } from '../components/MetricChart';
import { GRID } from '../lib/layout';
import { useSnapshot, useMeta } from '../api/hooks';
import { pickHead } from '../lib/head';

interface Props {
  win: { sec: number; step: number };
  nodes: string[];
}

const PCT = ['#4fc3f7', '#ffb74d', '#81c784', '#f06292', '#ba68c8', '#26a69a'];

export function SpecDecode({ win, nodes }: Props) {
  const snap = useSnapshot(2000);
  const head = pickHead(nodes, snap);
  const meta = useMeta();
  return (
    <div style={GRID}>
      <MetricChart
        title="投机接受率 (accepted/draft)" unit="%"
        series={[{ node: head, name: 'vllm.spec_accept_rate', label: '接受率', scale: 100 }]}
        window={win} nodes={nodes} refreshMs={15000}
        yDomain={[0, 100]}
      />
      <MetricChart
        title="平均接受长度" unit="tok"
        series={[{ node: head, name: 'vllm.spec_accept_len', label: 'accept len' }]}
        window={win} nodes={nodes} refreshMs={15000}
      />
      <MetricChart
        title="draft / accepted 吞吐" unit="tok/s"
        series={[
          { node: head, name: 'vllm.spec_draft_total', label: 'draft(tot)' },
          { node: head, name: 'vllm.spec_accept_total', label: 'accepted(tot)' },
        ]}
        window={win} nodes={nodes} refreshMs={15000}
      />
      {meta.specPerPos === false ? (
        <div style={{ background: '#111720', border: '1px solid #1e2836', borderRadius: 10, padding: '12px 14px', minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#cfd8e6', marginBottom: 6 }}>MTP 各位置接受率</div>
          <div style={{ fontSize: 12, color: '#7c8aa0', lineHeight: 1.6 }}>
            本引擎（{meta.model || '当前模型'} / TensorFold）只导出<b>总体</b> draft/accepted，<b>不提供逐位置接受率</b>，
            故此图在当前集群不可用（总体上方的「接受率 / 平均接受长度」图有效）。
          </div>
        </div>
      ) : (
        <MetricChart
          title="MTP 各位置接受率" unit="%"
          series={[0, 1, 2, 3, 4].map((k) => ({ // 与本模型实际发布的 MTP 档位一致（agent 动态采集）
            node: head,
            name: `vllm.spec_pos_${k}_rate`,
            label: `pos${k}`,
            color: PCT[k % PCT.length],
            scale: 100,
          }))}
          window={win} nodes={nodes} refreshMs={15000}
          yDomain={[0, 100]}
        />
      )}
    </div>
  );
}
