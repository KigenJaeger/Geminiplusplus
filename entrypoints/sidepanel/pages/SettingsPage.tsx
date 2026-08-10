import { useEffect, useState } from 'react';
import { api, type InjectionSettings } from '../runtime-client';
import { conversationToMarkdown, exportFilename } from '../../../core/gemini/conversation-export';

export default function SettingsPage() {
  const [settings, setSettings] = useState<InjectionSettings | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [configMsg, setConfigMsg] = useState('');

  async function handleExport() {
    setExportMsg('');
    setError('');
    setExporting(true);
    try {
      const { conversation } = await api.exportConversation();
      if (!conversation || conversation.turns.length === 0) {
        setExportMsg('未在当前页面找到可导出的对话，请先在 Gemini 打开一个会话。');
        return;
      }
      const markdown = conversationToMarkdown(conversation);
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exportFilename(conversation)}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMsg(`已导出 ${conversation.turns.length} 条消息`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  async function handleConfigExport() {
    try {
      const { backup } = await api.exportConfig();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `gemini-plus-plus-config-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); setConfigMsg('配置已导出');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  function handleConfigImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    void file.text().then(async (text) => {
      const backup = JSON.parse(text) as unknown;
      const replace = window.confirm('导入配置将覆盖同名技能、预设和项目；确定继续吗？\n点击“取消”则合并导入。');
      await api.importConfig(backup, replace ? 'replace' : 'merge'); setConfigMsg(replace ? '配置已覆盖导入' : '配置已合并导入');
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.getSettings();
        setSettings(res.settings);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  async function handleSave() {
    if (!settings) return;
    try {
      const res = await api.saveSettings(settings);
      setSettings(res.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!settings) return <div className="gem-page"><div className="gem-muted">加载中…</div></div>;

  return (
    <div className="gem-page">
      <h2 className="gem-page-title">设置</h2>
      <p className="gem-muted">控制 Gemini++ 的注入行为。所有数据仅保存在本机。</p>

      {error && <div className="gem-error">{error}</div>}
      {saved && <div className="gem-success">已保存</div>}

      <div className="gem-card">
        <div className="gem-setting-row">
          <div>
            <div className="gem-setting-title">注入长期记忆</div>
            <div className="gem-muted">把记忆库内容随消息注入 Gemini</div>
          </div>
          <label className="gem-switch">
            <input
              type="checkbox"
              checked={settings.memoryEnabled}
              onChange={(e) => setSettings({ ...settings, memoryEnabled: e.target.checked })}
            />
            <span className="gem-switch-track" />
          </label>
        </div>

        <div className="gem-setting-row">
          <div>
            <div className="gem-setting-title">启用预设注入</div>
            <div className="gem-muted">按节奏注入激活的系统提示词预设</div>
          </div>
          <label className="gem-switch">
            <input
              type="checkbox"
              checked={settings.presetEnabled}
              onChange={(e) => setSettings({ ...settings, presetEnabled: e.target.checked })}
            />
            <span className="gem-switch-track" />
          </label>
        </div>

        <div className="gem-setting-row">
          <div>
            <div className="gem-setting-title">预设注入节奏</div>
            <div className="gem-muted">仅首条消息 / 每条消息 / 关闭</div>
          </div>
          <select
            value={settings.presetCadence}
            onChange={(e) => setSettings({ ...settings, presetCadence: e.target.value as InjectionSettings['presetCadence'] })}
          >
            <option value="first_message">仅首条消息</option>
            <option value="every_message">每条消息</option>
            <option value="off">关闭</option>
          </select>
        </div>

        <div className="gem-actions">
          <button className="gem-btn gem-btn-primary" onClick={handleSave}>保存设置</button>
        </div>
      </div>

      <div className="gem-card">
        <div className="gem-setting-row"><div><div className="gem-setting-title">本地配置备份</div><div className="gem-muted">导出或恢复技能、预设、项目和注入设置；文件只保存在你选择的位置。</div></div><div className="gem-actions"><button className="gem-btn" onClick={() => void handleConfigExport()}>导出配置</button><label className="gem-btn gem-btn-ghost">导入配置<input type="file" accept="application/json,.json" hidden onChange={handleConfigImport} /></label></div></div>
        {configMsg && <div className="gem-success" style={{ marginTop: 8 }}>{configMsg}</div>}
      </div>

      <div className="gem-card">
        <div className="gem-setting-row">
          <div>
            <div className="gem-setting-title">导出当前对话</div>
            <div className="gem-muted">把 Gemini 页面上的当前会话导出为 Markdown 文件</div>
          </div>
          <button className="gem-btn" onClick={handleExport} disabled={exporting}>
            {exporting ? '导出中…' : '导出 Markdown'}
          </button>
        </div>
        {exportMsg && <div className="gem-muted" style={{ marginTop: 8 }}>{exportMsg}</div>}
      </div>

      <div className="gem-card">
        <h3>使用说明</h3>
        <ul className="gem-muted gem-list">
          <li>技能：在 Gemini 输入框输入 <code>/技能名 你的问题</code>，Gemini++ 会在发送请求时把技能指令注入，你的输入框气泡保持干净。</li>
          <li>记忆：记忆在每次消息发送前自动注入（技能可单独关闭记忆联动）。</li>
          <li>预设：激活的预设按节奏自动注入。</li>
          <li>注入在网络层完成（改写 batchexecute 请求体），不会把系统规则显示在你的消息气泡里；刷新页面后从服务器加载的历史可能显示完整注入文本。</li>
        </ul>
      </div>
    </div>
  );
}
