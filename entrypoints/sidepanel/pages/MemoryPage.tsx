import { useEffect, useState } from 'react';
import { api, type MemoryRecord } from '../runtime-client';

const TYPES = ['user', 'feedback', 'topic', 'reference'] as const;
type MemoryType = typeof TYPES[number];

interface FormState {
  type: MemoryType;
  name: string;
  content: string;
  description: string;
  tags: string;
  pinned: boolean;
}

const EMPTY_FORM: FormState = { type: 'user', name: '', content: '', description: '', tags: '', pinned: false };

export default function MemoryPage() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const res = await api.getMemories();
      setMemories(res.memories);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function handleSave() {
    if (!form) return;
    if (!form.name.trim() || !form.content.trim()) {
      setError('标题与内容不能为空');
      return;
    }
    try {
      await api.saveMemory({
        type: form.type,
        name: form.name.trim(),
        content: form.content.trim(),
        description: form.description.trim(),
        tags: form.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
        pinned: form.pinned,
      });
      setForm(null);
      setError('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('删除这条记忆？')) return;
    try {
      await api.deleteMemory(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) return <div className="gem-page"><div className="gem-muted">加载中…</div></div>;

  return (
    <div className="gem-page">
      <h2 className="gem-page-title">长期记忆</h2>
      <p className="gem-muted">
        记忆会在每次对话时自动注入（可在设置中关闭）。数据仅保存在本机 IndexedDB。
      </p>

      {error && <div className="gem-error">{error}</div>}

      {form && (
        <div className="gem-card">
          <h3>新建记忆</h3>
          <label className="gem-field">
            <span>类型</span>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as MemoryType })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="gem-field">
            <span>标题</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：用户偏好" />
          </label>
          <label className="gem-field">
            <span>内容</span>
            <textarea rows={5} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="记忆的具体内容…" />
          </label>
          <label className="gem-field">
            <span>描述</span>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="何时使用这条记忆" />
          </label>
          <label className="gem-field">
            <span>标签（逗号分隔）</span>
            <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="工作, 偏好" />
          </label>
          <label className="gem-check">
            <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
            固定（始终注入）
          </label>
          <div className="gem-actions">
            <button className="gem-btn" onClick={handleSave}>保存</button>
            <button className="gem-btn gem-btn-ghost" onClick={() => setForm(null)}>取消</button>
          </div>
        </div>
      )}

      <div className="gem-card-list">
        {memories.length === 0 && <div className="gem-muted">还没有记忆。点击「新建记忆」添加。</div>}
        {memories.map((m) => (
          <div key={m.id} className="gem-card gem-card-row">
            <div className="gem-card-main">
              <div className="gem-card-title">
                {m.name}
                {m.pinned && <span className="gem-badge">固定</span>}
                <span className="gem-badge gem-badge-ghost">{m.type}</span>
              </div>
              <div className="gem-muted gem-multiline">{m.content}</div>
              {m.tags.length > 0 && (
                <div className="gem-tags">{m.tags.map((t) => <span key={t} className="gem-tag">{t}</span>)}</div>
              )}
            </div>
            <div className="gem-card-actions">
              <button className="gem-btn gem-btn-danger gem-btn-sm" onClick={() => m.id !== undefined && void handleDelete(m.id)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {!form && (
        <button className="gem-btn gem-btn-primary gem-fab" onClick={() => setForm({ ...EMPTY_FORM })}>
          ＋ 新建记忆
        </button>
      )}
    </div>
  );
}
