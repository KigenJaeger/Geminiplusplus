import { useEffect, useState } from 'react';
import { api, type PresetRecord } from '../runtime-client';

interface FormState {
  id?: string;
  name: string;
  content: string;
}

const EMPTY_FORM: FormState = { name: '', content: '' };

export default function PresetPage() {
  const [presets, setPresets] = useState<PresetRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState('');

  async function refresh() {
    try {
      const res = await api.getPresets();
      setPresets(res.presets);
      setActiveId(res.activePresetId);
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
      setError('名称与内容不能为空');
      return;
    }
    try {
      await api.savePreset({ name: form.name.trim(), content: form.content }, form.id);
      setForm(null);
      setError('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleActivate(id: string | null) {
    try {
      await api.setActivePreset(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('删除这个预设？')) return;
    try {
      await api.deletePreset(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) return <div className="gem-page"><div className="gem-muted">加载中…</div></div>;

  return (
    <div className="gem-page">
      <h2 className="gem-page-title">系统提示词预设</h2>
      <p className="gem-muted">
        激活一个预设后，Gemini++ 会在新对话的首条消息（或每条消息，见设置）自动注入预设内容。
      </p>

      {error && <div className="gem-error">{error}</div>}

      {form && (
        <div className="gem-card">
          <h3>{form.id ? '编辑预设' : '新建预设'}</h3>
          <label className="gem-field">
            <span>名称</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：专业翻译" />
          </label>
          <label className="gem-field">
            <span>内容</span>
            <textarea rows={8} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="系统提示词内容…" />
          </label>
          <div className="gem-actions">
            <button className="gem-btn" onClick={handleSave}>保存</button>
            <button className="gem-btn gem-btn-ghost" onClick={() => setForm(null)}>取消</button>
          </div>
        </div>
      )}

      <div className="gem-card-list">
        {presets.length === 0 && <div className="gem-muted">还没有预设。点击「新建预设」创建。</div>}
        {presets.map((p) => (
          <div key={p.id} className="gem-card gem-card-row">
            <div className="gem-card-main">
              <div className="gem-card-title">
                {p.name}
                {activeId === p.id && <span className="gem-badge gem-badge-active">已激活</span>}
              </div>
              <div className="gem-muted gem-multiline">{p.content}</div>
            </div>
            <div className="gem-card-actions">
              <button
                className="gem-btn gem-btn-sm"
                onClick={() => void handleActivate(activeId === p.id ? null : p.id)}
              >
                {activeId === p.id ? '停用' : '激活'}
              </button>
              <button
                className="gem-btn gem-btn-ghost gem-btn-sm"
                onClick={() => setForm({ id: p.id, name: p.name, content: p.content })}
              >
                编辑
              </button>
              <button className="gem-btn gem-btn-danger gem-btn-sm" onClick={() => void handleDelete(p.id)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {!form && (
        <button className="gem-btn gem-btn-primary gem-fab" onClick={() => setForm({ ...EMPTY_FORM })}>
          ＋ 新建预设
        </button>
      )}
    </div>
  );
}
