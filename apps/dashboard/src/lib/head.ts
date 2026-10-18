import type { AllSnapshots } from '../api/client';

/**
 * Pick the node that actually serves vLLM metrics.
 *
 * Deployment note: the central returns nodes ordered by node id, which has
 * nothing to do with which node runs the inference API. On a two-node cluster
 * the lexicographically first id can be the WORKER — every vLLM card/chart on
 * the service-layer pages would then read a snapshot without any `vllm.*`
 * series and render empty.
 *
 * Rule: the node reporting `vllm.*` series is the head. Falls back to the first
 * node when no node reports them (engine down, or a single-node deployment), so
 * behaviour stays sane when inference metrics are temporarily unavailable.
 */
export function pickHead(nodes: string[], snap: AllSnapshots | undefined): string {
  for (const n of nodes) {
    const s = snap?.[n];
    if (s && Object.keys(s).some((k) => k.startsWith('vllm.'))) return n;
  }
  return nodes[0] ?? '';
}
