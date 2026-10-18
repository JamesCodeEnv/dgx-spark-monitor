import { useEffect, useState } from 'react';
import { useNodes, useMeta } from './api/hooks';
import { Overview } from './pages/Overview';
import { GpuHost } from './pages/GpuHost';
import { ThroughputLatency } from './pages/ThroughputLatency';
import { SpecDecode } from './pages/SpecDecode';
import { CacheQueue } from './pages/CacheQueue';
import { LMCache } from './pages/LMCache';
import { Network } from './pages/Network';
import { Cost } from './pages/Cost';
import { Settings } from './pages/Settings';
import { DEFAULT_WINDOW, WINDOWS } from './lib/charts';
import { useViewportWidth } from './lib/layout';
import { WindowPicker } from './components/WindowPicker';
import { ErrorBoundary } from './components/ErrorBoundary';

type Tab = 'overview' | 'gpu' | 'throughput' | 'spec' | 'cache' | 'lmcache' | 'network' | 'cost' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '总览' },
  { id: 'gpu', label: 'GPU/主机' },
  { id: 'throughput', label: '吞吐/延迟' },
  { id: 'spec', label: '投机解码' },
  { id: 'cache', label: '缓存/队列' },
  { id: 'lmcache', label: 'LMCache' },
  { id: 'network', label: '网络' },
  { id: 'cost', label: '成本' },
  { id: 'settings', label: '节点配置' },
];

// 成本页按「天」聚合，时序页按秒级采样：同一处控件，两套选项（选项随页切换，选择按页记住）。
const COST_RANGES = [
  { label: '近7天', days: 7 },
  { label: '近30天', days: 30 },
  { label: '近90天', days: 90 },
  { label: '全部', days: 365 },
];
const COST_OPTIONS = COST_RANGES.map((r) => ({ label: r.label }));
const TIME_OPTIONS = WINDOWS.map((w) => ({ label: w.label }));

function tabFromHash(): Tab {
  const h = window.location.hash.slice(1).replace(/^\//, '') as Tab;
  return TABS.some((t) => t.id === h) ? h : 'overview';
}

export default function App() {
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  // Each tab keeps its own selection, so choosing "全部" on Cost never makes a series page pull 365 days.
  const [winByTab, setWinByTab] = useState<Partial<Record<Tab, number>>>({});
  const { nodes } = useNodes(10_000);
  const meta = useMeta();
  const ids = nodes.map((n) => n.id);
  const isCost = tab === 'cost';
  const isSettings = tab === 'settings';
  const options = isCost ? COST_OPTIONS : TIME_OPTIONS;
  const idx = winByTab[tab] ?? (isCost ? 1 : DEFAULT_WINDOW);
  const setIdx = (i: number) => setWinByTab((prev) => ({ ...prev, [tab]: i }));
  const win = WINDOWS[Math.min(Math.max(idx, 0), WINDOWS.length - 1)];
  const costDays = COST_RANGES[Math.min(Math.max(idx, 0), COST_RANGES.length - 1)].days;
  const picker = isSettings ? null : (
    <WindowPicker idx={idx} onChange={setIdx} options={options} label={isCost ? '统计范围' : '时间窗'} />
  );
  const width = useViewportWidth();
  const narrow = width < 760;
  const wideHeader = width >= 1200; // PC：单行、导航居中；否则拆行

  const setTab = (t: Tab) => {
    setTabState(t);
    window.location.hash = '/' + t;
  };

  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.title = meta.cluster ? `${meta.cluster} · DGX Spark 监控` : 'DGX Spark 集群监控';
  }, [meta.cluster]);

  const nodeDots = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, flexWrap: 'wrap' }}>
      {nodes.map((n) => (
        <span key={n.id} style={{ color: n.ok ? '#6ee7a8' : '#ef5350', whiteSpace: 'nowrap' }} title={n.url}>
          ● {n.id}
          {n.hostname && n.hostname !== n.id && !wideHeader ? ` (${n.hostname})` : ''}
        </span>
      ))}
      {nodes.length === 0 && <span style={{ color: '#7c8aa0' }}>未配置节点</span>}
    </div>
  );

  const tabButtons = TABS.map((t) => (
    <button
      key={t.id}
      onClick={() => setTab(t.id)}
      style={{
        border: 'none', background: tab === t.id ? '#1c2638' : 'transparent',
        color: tab === t.id ? '#e8eef8' : '#94a3bb', borderRadius: 8,
        padding: narrow ? '6px 10px' : '6px 14px', fontSize: 13, cursor: 'pointer',
      }}
    >
      {t.label}
    </button>
  ));

  const title = (
    <div style={{ fontWeight: 700, fontSize: narrow ? 14 : 16, color: '#e8eef8', whiteSpace: 'nowrap' }}>
      DGX Spark 集群监控
      {!narrow && meta.cluster && (
        <span style={{ fontSize: 11, color: '#5f7190', marginLeft: 10, fontWeight: 400 }}>
          {meta.cluster}
        </span>
      )}
    </div>
  );

  // margin:0 auto on the inner row centres the tabs when they fit; when they
  // overflow (mobile) the auto margins collapse and the strip scrolls from the
  // first tab instead of clipping it.
  const tabStrip = (
    <nav className="tabbar" style={{ display: 'flex', minWidth: 0, maxWidth: '100%' }}>
      <div style={{ display: 'flex', gap: 4, margin: '0 auto', padding: narrow ? '0 0 2px' : 0 }}>
        {tabButtons}
      </div>
    </nav>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0b0e14', minWidth: 0 }}>
      <header
        style={{
          borderBottom: '1px solid #1e2836',
          background: '#0e1320',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          minWidth: 0,
        }}
      >
        {wideHeader ? (
          /* PC 宽屏：三栏网格 1fr auto 1fr——导航在视口正中，而非“剩余空间”里居中 */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
              gap: 16,
              padding: '12px 20px 14px',
              minWidth: 0,
            }}
          >
            <div style={{ justifySelf: 'start', minWidth: 0 }}>{title}</div>
            <div style={{ justifySelf: 'center', minWidth: 0, maxWidth: '100%' }}>{tabStrip}</div>
            <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              {picker && <div style={{ flex: '0 0 auto' }}>{picker}</div>}
              <div style={{ flex: '0 0 auto', minWidth: 0 }}>{nodeDots}</div>
            </div>
          </div>
        ) : (
          <>
            {/* 中屏/手机：标题行 + 居中页签行（窄屏可横向滑动）+ 时间窗/状态行 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: narrow ? '10px 12px 6px' : '12px 16px 6px', flexWrap: 'wrap', minWidth: 0 }}>
              {title}
              {!narrow && (
                <>
                  {picker}
                  <div style={{ marginLeft: 'auto', minWidth: 0 }}>{nodeDots}</div>
                </>
              )}
            </div>
            <div style={{ padding: narrow ? '0 10px 6px' : '0 16px 8px' }}>{tabStrip}</div>
            {narrow && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '0 12px 10px', minWidth: 0 }}>
                {picker}
                <div style={{ minWidth: 0 }}>{nodeDots}</div>
              </div>
            )}
          </>
        )}
      </header>
      <main style={{ padding: narrow ? 10 : 18, maxWidth: 1400, margin: '0 auto', minWidth: 0 }}>
        <ErrorBoundary key={tab}>
        {tab === 'overview' && <Overview win={win} nodes={ids} />}
        {tab === 'gpu' && <GpuHost win={win} nodes={ids} />}
        {tab === 'throughput' && <ThroughputLatency win={win} nodes={ids} />}
        {tab === 'spec' && <SpecDecode win={win} nodes={ids} />}
        {tab === 'cache' && <CacheQueue win={win} nodes={ids} />}
        {tab === 'lmcache' && <LMCache win={win} nodes={ids} />}
        {tab === 'network' && <Network win={win} nodes={ids} />}
        {tab === 'cost' && <Cost days={costDays} />}
        {tab === 'settings' && <Settings />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
