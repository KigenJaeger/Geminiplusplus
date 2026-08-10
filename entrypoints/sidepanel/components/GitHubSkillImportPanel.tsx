// GitHub Skill 导入面板：输入 URL → 预览 → 选择 → 导入（移植自 DeepSeek++ GitHubSkillImportPanel）
import { useMemo, useRef, useState } from 'react';
import type { GitHubImportResult, GitHubSkillPreview, GitHubSkillPreviewItem } from '../../../core/skill/github-importer';
import { api } from '../runtime-client';

type ImportState = 'idle' | 'previewing' | 'ready' | 'importing' | 'success' | 'error';

const GITHUB_ORIGINS = ['https://api.github.com/*', 'https://raw.githubusercontent.com/*'];

async function requestGitHubPermission(): Promise<boolean> {
  if (!chrome.permissions?.contains || !chrome.permissions?.request) return true;
  const granted = await chrome.permissions.contains({ origins: GITHUB_ORIGINS }).catch(() => false);
  if (granted) return true;
  return chrome.permissions.request({ origins: GITHUB_ORIGINS }).catch(() => false);
}

export default function GitHubSkillImportPanel({ onImported, onCancel }: {
  onImported: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<ImportState>('idle');
  const [preview, setPreview] = useState<GitHubSkillPreview | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<GitHubImportResult | null>(null);
  const latestUrlRef = useRef('');
  const previewRequestIdRef = useRef(0);

  const selectedCount = selectedPaths.size;
  const allSelected = preview ? preview.skills.length > 0 && selectedCount === preview.skills.length : false;
  const canPreview = url.trim().length > 0 && state !== 'previewing' && state !== 'importing';
  const canImport = Boolean(preview) && selectedCount > 0 && state !== 'importing' && state !== 'previewing';

  const selectedBytes = useMemo(() => {
    if (!preview) return 0;
    return preview.skills
      .filter((skill) => selectedPaths.has(skill.path))
      .reduce((sum, skill) => sum + skill.bytes, 0);
  }, [preview, selectedPaths]);

  const runPreview = async () => {
    const requestedUrl = url.trim();
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    setState('previewing');
    setMessage('');
    setResult(null);
    try {
      const granted = await requestGitHubPermission();
      if (!granted) throw new Error('需要 GitHub API 访问权限才能读取仓库 Skill');
      const response = await api.previewGitHubSkill(requestedUrl);
      if (requestId !== previewRequestIdRef.current || latestUrlRef.current.trim() !== requestedUrl) return;
      const nextPreview = response.preview;
      setPreview(nextPreview);
      setSelectedPaths(new Set(nextPreview.skills.map((skill) => skill.path)));
      setState('ready');
    } catch (error) {
      if (requestId !== previewRequestIdRef.current || latestUrlRef.current.trim() !== requestedUrl) return;
      setPreview(null);
      setSelectedPaths(new Set());
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const runImport = async () => {
    if (!preview || selectedPaths.size === 0) return;
    setState('importing');
    setMessage('');
    try {
      const response = await api.importGitHubSkill(url.trim(), [...selectedPaths]);
      const importResult = response.result;
      setResult(importResult);
      setState('success');
      const summary = importResult.replaced > 0
        ? `已更新 ${importResult.replaced} 个已有技能，新增 ${importResult.imported.length - importResult.replaced} 个技能`
        : `成功导入 ${importResult.imported.length} 个技能`;
      setMessage(summary);
      await onImported();
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const togglePath = (path: string) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (!preview) return;
    setSelectedPaths(allSelected ? new Set() : new Set(preview.skills.map((skill) => skill.path)));
  };

  return (
    <div className="gem-card">
      <div className="gem-card-title">
        <span>从 GitHub 导入 Skill</span>
        <button className="gem-btn gem-btn-ghost gem-btn-sm" onClick={onCancel}>关闭</button>
      </div>
      <p className="gem-muted" style={{ margin: '0 0 10px' }}>
        支持 GitHub 仓库、目录或单个 SKILL.md 链接（也支持 raw.githubusercontent.com）。
      </p>

      <div className="gem-field" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="url"
          placeholder="https://github.com/owner/repo 或 .../SKILL.md"
          value={url}
          onChange={(event) => {
            const nextUrl = event.target.value;
            setUrl(nextUrl);
            latestUrlRef.current = nextUrl;
            previewRequestIdRef.current += 1;
            setPreview(null);
            setSelectedPaths(new Set());
            setResult(null);
            setMessage('');
            if (state !== 'importing') setState('idle');
          }}
          onKeyDown={(event) => event.key === 'Enter' && canPreview && void runPreview()}
        />
        <button
          type="button"
          className="gem-btn gem-btn-primary"
          onClick={() => void runPreview()}
          disabled={!canPreview}
        >
          {state === 'previewing' ? '预览中…' : '预览'}
        </button>
      </div>

      {preview && (
        <>
          <SourceSummary preview={preview} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}>
            <button type="button" className="gem-btn gem-btn-sm" onClick={toggleAll}>
              {allSelected ? '清空选择' : '全选'}
            </button>
            <span className="gem-muted">
              已选 {selectedCount}/{preview.skills.length} · {formatBytes(selectedBytes)}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {preview.skills.map((skill) => (
              <PreviewSkillRow key={skill.path} skill={skill} checked={selectedPaths.has(skill.path)} onToggle={() => togglePath(skill.path)} />
            ))}
          </div>

          <div className="gem-actions" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="gem-btn" onClick={onCancel}>取消</button>
            <button type="button" className="gem-btn gem-btn-primary" onClick={() => void runImport()} disabled={!canImport}>
              {state === 'importing' ? '导入中…' : '导入所选'}
            </button>
          </div>
        </>
      )}

      {message && (
        <div className={state === 'success' ? 'gem-success' : 'gem-error'} style={{ whiteSpace: 'pre-wrap' }}>
          {message}
          {result && result.renamed > 0 && `\n${result.renamed} 个技能因重名自动改名`}
        </div>
      )}
    </div>
  );
}

function SourceSummary({ preview }: { preview: GitHubSkillPreview }) {
  const warnings = [
    ...preview.warnings,
    ...preview.skills.flatMap((skill) => skill.warnings.map((warning) => `${skill.importName}: ${warning}`)),
  ];
  return (
    <div className="gem-card" style={{ background: 'var(--gem-bg)' }}>
      <div className="gem-card-title">
        <span>{preview.repository}</span>
        <a className="gem-tag" href={preview.repoUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
          打开仓库 ↗
        </a>
      </div>
      <div className="gem-muted" style={{ wordBreak: 'break-all' }}>
        {preview.rootPath || '仓库根目录'} · {preview.ref} · {preview.commitSha.slice(0, 7)}
      </div>
      <div className="gem-tags">
        <span className="gem-tag">License: {preview.licenseSpdxId ?? preview.licenseName ?? 'Unknown'}</span>
        <span className="gem-tag">分支: {preview.defaultBranch}</span>
        <span className="gem-tag">Skill: {preview.skills.length}</span>
      </div>
      {warnings.length > 0 && (
        <div className="gem-error" style={{ whiteSpace: 'pre-wrap' }}>
          {warnings.slice(0, 4).map((warning) => `• ${warning}`).join('\n')}
          {warnings.length > 4 && `\n• 其余 ${warnings.length - 4} 条警告略`}
        </div>
      )}
    </div>
  );
}

function PreviewSkillRow({ skill, checked, onToggle }: {
  skill: GitHubSkillPreviewItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="gem-card" style={{ display: 'flex', gap: 8, cursor: 'pointer', marginBottom: 0 }}>
      <input type="checkbox" checked={checked} onChange={onToggle} style={{ marginTop: 2, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="gem-card-title">
          <code>/{skill.importName}</code>
          {skill.nameChanged && <span className="gem-badge gem-badge-ghost">已改名</span>}
          {skill.existingSkillName && <span className="gem-badge gem-badge-active">已导入（将更新）</span>}
          {skill.version && <span className="gem-badge gem-badge-ghost">v{skill.version}</span>}
        </div>
        <div className="gem-muted" style={{ marginBottom: 4 }}>{skill.description}</div>
        <div className="gem-tags">
          <span className="gem-tag">{skill.path}</span>
          <span className="gem-tag">{formatBytes(skill.bodyBytes)}</span>
          <span className="gem-tag">资源 {skill.includedFiles.length}</span>
          {skill.omittedFiles.length > 0 && <span className="gem-tag">略过 {skill.omittedFiles.length}</span>}
        </div>
      </div>
    </label>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
