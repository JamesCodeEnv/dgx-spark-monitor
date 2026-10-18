import { useEffect, useState } from 'react';
import { getNodes, getSnapshot, getMeta, getCost, type NodeInfo, type AllSnapshots, type Meta, type CostResponse } from './client';

export function useNodes(intervalMs = 10_000): { nodes: NodeInfo[]; refresh: () => void } {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const refresh = () => void getNodes().then(setNodes).catch(() => {});
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return { nodes, refresh };
}

export function useSnapshot(intervalMs = 2000): AllSnapshots {
  const [snap, setSnap] = useState<AllSnapshots>({});
  useEffect(() => {
    let stop = false;
    const load = () =>
      void getSnapshot()
        .then((d) => !stop && setSnap(d))
        .catch(() => {});
    load();
    const t = setInterval(load, intervalMs);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [intervalMs]);
  return snap;
}

/** 本中控监控的集群标签（来自 .env CLUSTER_NAME / SERVED_MODEL），用于标题。 */
export function useMeta(intervalMs = 60_000): Meta {
  const [meta, setMeta] = useState<Meta>({ cluster: '', model: '' });
  useEffect(() => {
    let stop = false;
    const load = () =>
      void getMeta()
        .then((m) => !stop && setMeta(m))
        .catch(() => {});
    load();
    const t = setInterval(load, intervalMs);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [intervalMs]);
  return meta;
}

/** 成本页数据（按历史价目 + 峰谷折算）。默认每 60s 刷新。 */
export function useCost(days = 30, intervalMs = 60_000): CostResponse | null {
  const [data, setData] = useState<CostResponse | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      void getCost(days)
        .then((d) => !stop && setData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, intervalMs);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [days, intervalMs]);
  return data;
}
