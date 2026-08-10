import { useEffect, useState } from 'react';
import { api, type SkillRecord } from '../runtime-client';
import GitHubSkillImportPanel from '../components/GitHubSkillImportPanel';

interface FormState {
  name: string;
  description: string;
  instructions: string;
  memoryEnabled: boolean;
  previousName?: string;
}

const EMPTY_FORM: FormState = { name: '', description: '', instructions: '', memoryEnabled: false };

export default function SkillPage() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState('');
  const [showGitHubImport, setShowGitHubImport] = useState(false);

  async function refresh() {
    try {
      const res = await api.getSkills();
      setSkills(res.skills);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function handleToggle(name: string, enabled: boolean) {
    try {
      await api.setSkillEnabled(name, enabled);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(name: string) {
    if (!window.confirm(`删除技能「${name}」？`)) return;
    try {
      await api.deleteSkill(name);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSave() {
    if (!form) return;
    if (!form.name.trim() || !form.instructions.trim()) {
      setError('名称与指令不能为空');
      return;
    }
    try {
      await api.saveSkill({
        name: form.name.trim(),
        description: form.description.trim(),
        instructions: form.instructions,
        memoryEnabled: form.memoryEnabled,
      }, form.previousName);
      setForm(null);
      setError('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) return <div className="gem-page"><div className="gem-muted">加载中…</div></div>;

  return (
    <div className="gem-page">
      <h2 className="gem-page-title">技能 Skills</h2>
      <p className="gem-muted">
        在 Gemini 输入框输入 <code>/技能名</code> 即可激活技能（如 <code>/ultra-think 帮我分析…</code>）。
      </p>

      {error && <div className="gem-error">{error}</div>}

      {showGitHubImport && (
        <GitHubSkillImportPanel onImported={() => void refresh()} onCancel={() => setShowGitHubImport(false)} />
      )}

      {form && (
        <div className="gem-card">
          <h3>{form.previousName ? `编辑技能 ${form.previousName}` : '新建技能'}</h3>
          <label className="gem-field">
            <span>名称（用于 /命令）</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="my-skill" />
          </label>
          <label className="gem-field">
            <span>描述</span>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="技能用途简介" />
          </label>
          <label className="gem-field">
            <span>系统指令</span>
            <textarea rows={8} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} placeholder="你是一位…" />
          </label>
          <label className="gem-check">
            <input type="checkbox" checked={form.memoryEnabled} onChange={(e) => setForm({ ...form, memoryEnabled: e.target.checked })} />
            同时注入长期记忆
          </label>
          <div className="gem-actions">
            <button className="gem-btn" onClick={handleSave}>保存</button>
            <button className="gem-btn gem-btn-ghost" onClick={() => setForm(null)}>取消</button>
          </div>
        </div>
      )}

      <div className="gem-card-list">
        {skills.length === 0 && <div className="gem-muted">还没有技能。点击「新建技能」创建一个。</div>}
        {skills.map((skill) => (
          <div key={skill.name} className="gem-card gem-card-row">
            <div className="gem-card-main">
              <div className="gem-card-title">
                <code>/{skill.name}</code>
                {skill.source === 'builtin' && <span className="gem-badge">内置</span>}
                {skill.github && (
                  <span className="gem-badge gem-badge-ghost" title={`来源：${skill.github.repository}\n${skill.github.path}`}>
                    GitHub
                  </span>
                )}
                {skill.memoryWriteEnabled && <span className="gem-badge gem-badge-active">写入记忆</span>}
              </div>
              <div className="gem-muted">{skill.description || '（无描述）'}</div>
            </div>
            <div className="gem-card-actions">
              <label className="gem-switch">
                <input
                  type="checkbox"
                  checked={skill.enabled !== false}
                  onChange={(e) => void handleToggle(skill.name, e.target.checked)}
                />
                <span className="gem-switch-track" />
              </label>
              {skill.source === 'custom' && (
                <button
                  className="gem-btn gem-btn-ghost gem-btn-sm"
                  onClick={() => setForm({
                    name: skill.name,
                    description: skill.description,
                    instructions: skill.instructions,
                    memoryEnabled: skill.memoryEnabled,
                    previousName: skill.name,
                  })}
                >
                  编辑
                </button>
              )}
              {skill.source === 'custom' && (
                <button className="gem-btn gem-btn-danger gem-btn-sm" onClick={() => void handleDelete(skill.name)}>
                  删除
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {!form && (
        <div style={{ position: 'fixed', right: 16, bottom: 20, display: 'flex', gap: 8 }}>
          <button className="gem-btn" onClick={() => setShowGitHubImport(true)}>GitHub 导入</button>
          <button className="gem-btn gem-btn-primary" style={{ boxShadow: '0 4px 14px rgba(0,0,0,.18)' }} onClick={() => setForm({ ...EMPTY_FORM })}>
            ＋ 新建技能
          </button>
        </div>
      )}
    </div>
  );
}
