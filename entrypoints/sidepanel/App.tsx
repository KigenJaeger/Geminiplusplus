import { useState } from 'react';
import { useEffect } from 'react';
import { api } from './runtime-client';
import SkillPage from './pages/SkillPage';
import MemoryPage from './pages/MemoryPage';
import PresetPage from './pages/PresetPage';
import SettingsPage from './pages/SettingsPage';
import ProjectPage from './pages/ProjectPage';

type Tab = 'skills' | 'projects' | 'memory' | 'presets' | 'settings';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'skills', label: '技能', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { key: 'projects', label: '项目', icon: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z' },
  { key: 'memory', label: '记忆', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5s3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18s-3.332.477-4.5 1.253' },
  { key: 'presets', label: '预设', icon: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z' },
  { key: 'settings', label: '设置', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('skills');
  const [activeSkill, setActiveSkill] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let requestSequence = 0;
    const refresh = async () => {
      const sequence = ++requestSequence;
      try {
        const result = await api.getState();
        if (!disposed && sequence === requestSequence) setActiveSkill(result.state.activeSkill?.name ?? null);
      } catch {
        if (!disposed && sequence === requestSequence) setActiveSkill(null);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);

  return (
    <div className="gem-app-shell">
      <nav className="gem-side-tabs" aria-label="Gemini++ 导航">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`gem-side-tab${tab === t.key ? ' gem-side-tab-active' : ''}`}
            aria-current={tab === t.key ? 'page' : undefined}
            title={t.label}
          >
            <svg className="gem-side-tab-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
            </svg>
            <span className="gem-side-tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="gem-app-main">
        <div className={`gem-active-skill${activeSkill ? '' : ' gem-active-skill-empty'}`} role="status">
          {activeSkill ? <>本次已激活：<code>/{activeSkill}</code></> : '本次尚未激活 Skill'}
        </div>
        {tab === 'skills' && <SkillPage />}
        {tab === 'projects' && <ProjectPage />}
        {tab === 'memory' && <MemoryPage />}
        {tab === 'presets' && <PresetPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
