import { useEffect, useState } from 'react';
import { api } from '../runtime-client';
import type { Project } from '../../../core/types';

const EMPTY = { name: '', description: '', instructions: '' };

export default function ProjectPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Array<{ conversationId: string; projectId: string; title: string; url: string }>>([]);
  const [form, setForm] = useState<{ id?: string } & typeof EMPTY | null>(null);
  const [error, setError] = useState('');
  async function refresh() { try { const result = await api.getProjects(); setProjects(result.projects); setActiveId(result.activeProjectId); setPendingId(result.pendingProjectId); setConversations(result.conversations); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }
  useEffect(() => { void refresh(); }, []);
  async function save() { if (!form) return; try { await api.saveProject(form, form.id); setForm(null); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }
  async function remove(id: string) { if (!window.confirm('删除这个项目？')) return; try { await api.deleteProject(id); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }
  async function activate(id: string | null) { try { await api.setActiveProject(id); await api.setPendingProject(id); setActiveId(id); setPendingId(id); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }
  return <div className="gem-page">
    <h2 className="gem-page-title">项目</h2>
    <p className="gem-muted">项目说明会随 Gemini 网页端的每条新消息注入。它类似 DeepSeek++ 的项目工作区，帮助模型保持目标、约束和背景。</p>
    {error && <div className="gem-error">{error}</div>}
    {form && <div className="gem-card"><h3>{form.id ? '编辑项目' : '新建项目'}</h3>
      <label className="gem-field"><span>名称</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：Gemini++ 开发" /></label>
      <label className="gem-field"><span>描述</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      <label className="gem-field"><span>项目指令</span><textarea rows={9} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} placeholder="目标、技术栈、约束、交付标准…" /></label>
      <div className="gem-actions"><button className="gem-btn gem-btn-primary" onClick={() => void save()}>保存</button><button className="gem-btn gem-btn-ghost" onClick={() => setForm(null)}>取消</button></div>
    </div>}
    <div className="gem-card-list">{projects.map((project) => <div className="gem-card" key={project.id}><div className="gem-card-row"><div className="gem-card-main"><div className="gem-card-title">{project.name}{activeId === project.id && <span className="gem-badge gem-badge-active">当前</span>}{pendingId === project.id && <span className="gem-badge">下一次对话</span>}</div><div className="gem-muted">{project.description || '（无描述）'}</div></div><div className="gem-card-actions"><button className="gem-btn gem-btn-sm" onClick={() => void activate(activeId === project.id ? null : project.id)}>{activeId === project.id ? '停用' : '使用'}</button><button className="gem-btn gem-btn-ghost gem-btn-sm" onClick={() => setForm(project)}>编辑</button><button className="gem-btn gem-btn-danger gem-btn-sm" onClick={() => void remove(project.id)}>删除</button></div></div><div className="gem-muted" style={{ marginTop: 8 }}>{conversations.filter((item) => item.projectId === project.id).length === 0 ? '下一次对话会自动归入此项目' : conversations.filter((item) => item.projectId === project.id).map((item) => <a key={item.conversationId} href={item.url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>↳ {item.title}</a>)}</div></div>)}{projects.length === 0 && <div className="gem-muted">还没有项目。</div>}</div>
    {!form && <button className="gem-btn gem-btn-primary" onClick={() => setForm(EMPTY)}>＋ 新建项目</button>}
  </div>;
}
