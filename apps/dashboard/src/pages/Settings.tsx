import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { getConfig, createNode, updateNode, deleteNode, type NodeCfg } from '../api/client';
import { CARD_ROW, useViewportWidth } from '../lib/layout';

interface Form {
  id: string;
  name: string;
  url: string;
  enabled: number;
}

const EMPTY: Form = { id: '', name: '', url: '', enabled: 1 };

const inputStyle: CSSProperties = {
  background: '#0e1320', border: '1px solid #2a3648', borderRadius: 6,
  color: '#d7dde8', padding: '7px 8px', fontSize: 12, outline: 'none',
  width: '100%', minWidth: 0,
};

export function Settings() {
  const [nodes, setNodes] = useState<NodeCfg[]>([]);
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const narrow = useViewportWidth() < 760;

  const refresh = useCallback(() => {
    void getConfig()
      .then(setNodes)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 4000);
  };

  const startAdd = () => {
    setForm(EMPTY);
    setEditing('new');
    setErr('');
  };
  const startEdit = (n: NodeCfg) => {
    setForm({ id: n.id, name: n.name, url: n.url, enabled: n.enabled });
    setEditing(n.id);
    setErr('');
  };
  const cancel = () => {
    setEditing(null);
    setErr('');
  };

  const submit = async () => {
    setErr('');
    const id = form.id.trim();
    const url = form.url.trim();
    if (editing === 'new' && !id) return setErr('需要填写节点 id');
    if (!url || !/^https?:\/\//.test(url)) return setErr('Agent 地址必须以 http:// 或 https:// 开头');
    setSaving(true);
    try {
      if (editing === 'new') {
        // 新建走 POST；此前前端把带 id 的“新建”也发成 PUT，服务端 404 —— 即“加不了节点”的根因。
        await createNode({ id, name: form.name.trim(), url, enabled: form.enabled });
        flash(`已添加节点 ${id}，等待首次同步…`);
      } else if (editing) {
        await updateNode({ id: editing, name: form.name.trim(), url, enabled: form.enabled });
        flash(`已保存节点 ${editing}`);
      }
      setEditing(null);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (n: NodeCfg) => {
    if (!window.confirm(`删除节点 ${n.id}？（仅移除配置，不影响机器上的 agent）`)) return;
    setErr('');
    try {
      await deleteNode(n.id);
      flash(`已删除节点 ${n.id}`);
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const toggle = async (n: NodeCfg) => {
    setErr('');
    try {
      await updateNode({ id: n.id, enabled: n.enabled === 1 ? 0 : 1 });
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const stateOf = (n: NodeCfg): { color: string; text: string } => {
    if (n.ok) return { color: '#6ee7a8', text: '在线' };
    if (!n.lastOkTs) return { color: '#7c8aa0', text: '待首次同步' };
    return { color: '#ef5350', text: '离线' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {/* 快捷说明 */}
      <div
        style={{
          background: '#101828', border: '1px solid #1f2c42', borderRadius: 10,
          padding: '12px 16px', fontSize: 12, color: '#9fb0c8', lineHeight: 1.7,
        }}
      >
        在这里配置面板要拉取的机器（不是写在代码里）。步骤：① 在目标机器上装好 agent
        （见 GUIDE.md 第 3 步）② 点击「添加节点」，填 id 和 agent 地址 <code>http://&lt;IP&gt;:9100</code>
        ③ 保存后本页状态列会显示在线状态，其他页签立即开始出数据。
      </div>

      {err && (
        <div style={{ color: '#ef5350', fontSize: 12, background: '#2a1420', borderRadius: 8, padding: '8px 12px' }}>
          {err}
        </div>
      )}
      {notice && (
        <div style={{ color: '#6ee7a8', fontSize: 12, background: '#10281c', borderRadius: 8, padding: '8px 12px' }}>
          {notice}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#cfd8e6' }}>节点列表（{nodes.length}）</span>
        {editing === null && (
          <button
            onClick={startAdd}
            style={{ border: '1px solid #2f6f4f', background: '#123524', color: '#6ee7a8', borderRadius: 8, padding: '6px 16px', fontSize: 12, cursor: 'pointer' }}
          >
            + 添加节点
          </button>
        )}
      </div>

      {/* 编辑表单（新增/编辑共用） */}
      {editing !== null && (
        <div style={{ border: '1px solid #2a5a78', background: '#101c28', borderRadius: 10, padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {editing === 'new' && (
            <label style={{ ...fieldStyle, flex: '1 1 140px' }}>
              节点 id *
              <input style={inputStyle} value={form.id} placeholder="如 head / worker"
                onChange={(e) => setForm({ ...form, id: e.target.value })} />
            </label>
          )}
          <label style={{ ...fieldStyle, flex: '1 1 140px' }}>
            名称
            <input style={inputStyle} value={form.name} placeholder="显示名(可选)"
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label style={{ ...fieldStyle, flex: '2 1 220px' }}>
            Agent 地址 *
            <input style={inputStyle} value={form.url} placeholder="http://192.168.x.x:9100"
              onChange={(e) => setForm({ ...form, url: e.target.value })} />
          </label>
          <label style={{ ...fieldStyle, flex: '0 0 auto', justifyContent: 'flex-end' }}>
            启用
            <input type="checkbox" checked={form.enabled === 1} onChange={(e) => setForm({ ...form, enabled: e.target.checked ? 1 : 0 })} />
          </label>
          <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
            <button onClick={submit} disabled={saving}
              style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 18px', fontSize: 12, cursor: 'pointer' }}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button onClick={cancel}
              style={{ background: 'transparent', color: '#9fb0c8', border: '1px solid #2a3648', borderRadius: 8, padding: '7px 14px', fontSize: 12, cursor: 'pointer' }}>
              取消
            </button>
          </div>
        </div>
      )}

      {/* 节点列表：宽屏表格 / 窄屏卡片（手机上好点按，不用横向滚动） */}
      {narrow ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          {nodes.length === 0 && (
            <div style={{ color: '#7c8aa0', padding: 24, textAlign: 'center', border: '1px solid #1e2836', borderRadius: 10 }}>
              还没有节点 —— 点击「+ 添加节点」开始配置
            </div>
          )}
          {nodes.map((n) => {
            const st = stateOf(n);
            return (
              <div key={n.id} style={{ background: '#111720', border: '1px solid #1e2836', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <code style={{ color: '#4fc3f7', fontSize: 13 }}>{n.id}</code>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: st.color }} />
                    {st.text}
                    {n.hostname && <span style={{ color: '#7c8aa0' }}>({n.hostname})</span>}
                  </span>
                </div>
                {n.name && <div style={{ fontSize: 12, color: '#cfd8e6' }}>{n.name}</div>}
                <div style={{ fontSize: 12, color: '#9fb0c8', fontFamily: 'monospace', wordBreak: 'break-all' }}>{n.url}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#7c8aa0' }}>
                    指标 {n.series} · {n.lastOkTs ? `${Math.max(0, Math.round((Date.now() - n.lastOkTs) / 1000))}s 前` : '—'}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#7c8aa0' }}>
                      启用 <input type="checkbox" checked={n.enabled === 1} onChange={() => void toggle(n)} />
                    </label>
                    <button onClick={() => startEdit(n)} style={btn}>编辑</button>
                    <button onClick={() => void remove(n)} style={{ ...btn, color: '#ef5350', marginRight: 0 }}>删除</button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <div style={{ overflowX: 'auto', minWidth: 0, border: '1px solid #1e2836', borderRadius: 10 }}>
        <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#7c8aa0', textAlign: 'left' }}>
              <th style={thStyle}>节点 id</th>
              <th style={thStyle}>名称</th>
              <th style={thStyle}>Agent 地址</th>
              <th style={thStyle}>状态</th>
              <th style={thStyle}>指标数</th>
              <th style={thStyle}>最近同步</th>
              <th style={thStyle}>启用</th>
              <th style={thStyle}>操作</th>
            </tr>
          </thead>
          <tbody>
            {nodes.length === 0 && (
              <tr><td colSpan={8} style={{ color: '#7c8aa0', padding: 24, textAlign: 'center' }}>
                还没有节点 —— 点击「+ 添加节点」开始配置
              </td></tr>
            )}
            {nodes.map((n) => {
              const st = stateOf(n);
              return (
                <tr key={n.id} style={{ borderTop: '1px solid #1e2836' }}>
                  <td style={tdStyle}><code style={{ color: '#4fc3f7' }}>{n.id}</code></td>
                  <td style={tdStyle}>{n.name || '—'}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#9fb0c8' }}>{n.url}</td>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: st.color }} />
                      {st.text}
                      {n.hostname && <span style={{ color: '#7c8aa0' }}>({n.hostname})</span>}
                    </span>
                  </td>
                  <td style={tdStyle}>{n.series}</td>
                  <td style={tdStyle}>
                    {n.lastOkTs ? `${Math.max(0, Math.round((Date.now() - n.lastOkTs) / 1000))}s 前` : '—'}
                  </td>
                  <td style={tdStyle}>
                    <input type="checkbox" checked={n.enabled === 1} onChange={() => void toggle(n)} />
                  </td>
                  <td style={tdStyle}>
                    <button onClick={() => startEdit(n)} style={btn}>编辑</button>
                    <button onClick={() => void remove(n)} style={{ ...btn, color: '#ef5350' }}>删除</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      <div style={{ ...CARD_ROW, fontSize: 11, color: '#5f7190' }}>
        提示：新增节点后需要 1–2 个采集周期（约 10–20 秒）才会出现在其他页签的下拉/图例中。
      </div>
    </div>
  );
}

const fieldStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#7c8aa0', minWidth: 0,
};
const thStyle: CSSProperties = { padding: '8px 10px', fontWeight: 600, whiteSpace: 'nowrap' };
const tdStyle: CSSProperties = { padding: '8px 10px', color: '#d7dde8', whiteSpace: 'nowrap' };
const btn: CSSProperties = {
  background: 'transparent', border: '1px solid #2a3648', color: '#9fb0c8',
  borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', marginRight: 6,
};
