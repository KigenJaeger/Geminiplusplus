// GitHub Skill 导入：从 GitHub 仓库 / 目录 / 单个 SKILL.md 链接预览并导入第三方技能
// 移植自 DeepSeek++ core/skill/github-importer.ts，按 Gemini++ 简化：
// - 去掉 source 持久化 / registry / 云同步 / 更新比对，导入结果直接写入 chrome.storage 的自定义技能列表
// - 保留核心能力：URL 解析（repo / tree / blob / raw）、SKILL.md 解析、同目录文本资源合并、名称冲突处理
// - 同源同路径重导 = 覆盖更新（保留原名称与开关状态）

import type { Skill, SkillGithubMeta } from '../types';
import { getAllSkills, getCustomSkills, setCustomSkills } from './store';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';
const MAX_SKILLS_PER_SOURCE = 80;
const MAX_SKILL_BYTES = 120_000;
const MAX_RESOURCE_FILES_PER_SKILL = 16;
const MAX_RESOURCE_BYTES_PER_SKILL = 100_000;
const MAX_RESOURCE_FILE_BYTES = 40_000;
const REQUEST_TIMEOUT_MS = 20_000;

const TEXT_RESOURCE_EXTENSIONS = new Set(['.md', '.txt', '.yaml', '.yml', '.json', '.tex']);

// ---- 对外类型 ----

export interface GitHubSkillPreviewItem {
  path: string;
  name: string;
  importName: string;
  description: string;
  version?: string;
  bytes: number;
  bodyBytes: number;
  includedFiles: Array<{ path: string; bytes: number }>;
  omittedFiles: Array<{ path: string; bytes: number }>;
  warnings: string[];
  nameChanged: boolean;
  existingSkillName?: string;
}

export interface GitHubSkillPreview {
  repository: string;
  repoUrl: string;
  defaultBranch: string;
  ref: string;
  rootPath: string;
  commitSha: string;
  licenseName?: string;
  licenseSpdxId?: string;
  skills: GitHubSkillPreviewItem[];
  warnings: string[];
  truncated: boolean;
}

export interface GitHubImportResult {
  imported: Array<{ name: string; path: string }>;
  replaced: number;
  renamed: number;
  warnings: string[];
}

// ---- 内部类型 ----

interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  mode: 'repo' | 'tree' | 'blob';
  ref?: string;
  path: string;
  refPathParts?: string[];
  url: string;
}

interface GitHubRepoResponse {
  full_name: string;
  html_url: string;
  default_branch: string;
  description?: string | null;
  license?: { key?: string | null; spdx_id?: string | null; name?: string | null } | null;
}

interface GitHubCommitResponse {
  sha: string;
}

interface GitHubTreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  size?: number;
}

interface GitHubTreeResponse {
  sha: string;
  truncated: boolean;
  tree: GitHubTreeEntry[];
}

interface ParsedSkillDoc {
  name: string;
  description: string;
  body: string;
  version?: string;
}

interface SourceMeta {
  sourceUrlKey: string;
  repository: string;
  repoUrl: string;
  defaultBranch: string;
  ref: string;
  rootPath: string;
  commitSha: string;
  licenseName?: string;
  licenseSpdxId?: string;
}

interface LoadedGitHubSkill {
  item: GitHubSkillPreviewItem;
  skill: Skill;
}

// ---- 入口 ----

export async function previewGitHubSkill(url: string): Promise<GitHubSkillPreview> {
  return (await loadGitHubSkillSource(url)).preview;
}

export async function importGitHubSkill(request: { url: string; selectedPaths: string[] }): Promise<GitHubImportResult> {
  // 串行化导入：避免并发导入基于同一快照读改写导致丢失更新
  const run = importQueue.then(() => doImportGitHubSkill(request));
  importQueue = run.catch(() => undefined);
  return run;
}

let importQueue: Promise<unknown> = Promise.resolve();

async function doImportGitHubSkill(request: { url: string; selectedPaths: string[] }): Promise<GitHubImportResult> {
  if (request.selectedPaths.length === 0) throw new Error('至少选择一个 Skill 后再导入');

  const loaded = await loadGitHubSkillSource(request.url, new Set(request.selectedPaths));
  const selected = loaded.skills.filter((skill) => request.selectedPaths.includes(skill.item.path));
  if (selected.length === 0) throw new Error('选中的 Skill 路径在 GitHub 源中不存在');

  const custom = await getCustomSkills();
  const now = Date.now();
  let replaced = 0;
  let renamed = 0;
  let warnings = [...loaded.preview.warnings];

  const next: Skill[] = [...custom];
  for (const loadedSkill of selected) {
    const item = loadedSkill.item;
    const { skill } = loadedSkill;
    const existingIndex = next.findIndex(
      (s) => s.source === 'custom' && s.github?.sourceUrl === loaded.preview.sourceUrlKey && s.github.path === item.path,
    );
    if (existingIndex >= 0) {
      // 同源同路径重导：覆盖更新，保留名称与开关状态
      const existing = next[existingIndex]!;
      next[existingIndex] = {
        ...skill,
        name: existing.name,
        enabled: existing.enabled,
        memoryEnabled: existing.memoryEnabled,
      };
      replaced += 1;
    } else {
      next.push(skill);
      if (item.nameChanged) renamed += 1;
    }
    warnings.push(...item.warnings);
  }

  await setCustomSkills(next);
  return {
    imported: selected.map((s) => ({ name: s.skill.name, path: s.item.path })),
    replaced,
    renamed,
    warnings,
  };
}

// ---- 加载 ----

interface LoadedGitHubSource {
  preview: GitHubSkillPreview & { sourceUrlKey: string };
  skills: LoadedGitHubSkill[];
}

async function loadGitHubSkillSource(url: string, selectedPaths?: Set<string>): Promise<LoadedGitHubSource> {
  const parsedUrl = parseGitHubUrl(url);
  const repo = await fetchGitHubJson<GitHubRepoResponse>(`/repos/${parsedUrl.owner}/${parsedUrl.repo}`);
  const resolved = await resolveSourceLocation(parsedUrl, repo.default_branch);
  const tree = await fetchGitHubJson<GitHubTreeResponse>(
    `/repos/${parsedUrl.owner}/${parsedUrl.repo}/git/trees/${encodeURIComponent(resolved.ref)}?recursive=1`,
  );
  const sourceUrlKey = normalizeSourceUrl(parsedUrl.url);
  const skillPaths = findSkillPaths(tree, resolved.rootPath, parsedUrl.mode);
  const warnings: string[] = [];

  if (tree.truncated) warnings.push('GitHub 返回的仓库树已截断，可能遗漏部分 Skill 文件');
  if (skillPaths.length === 0) throw new Error('没有在这个 GitHub 链接下找到 SKILL.md');
  if (skillPaths.length > MAX_SKILLS_PER_SOURCE) {
    warnings.push(`找到 ${skillPaths.length} 个 Skill，仅预览前 ${MAX_SKILLS_PER_SOURCE} 个`);
  }

  const limitedPaths = skillPaths.slice(0, MAX_SKILLS_PER_SOURCE);
  const existingCustom = await getCustomSkills();
  const occupiedNames = new Set((await getAllSkills()).map((s) => s.name));
  const bySourcePath = new Map(
    existingCustom
      .filter((s) => s.source === 'custom' && s.github)
      .map((s) => [`${s.github!.sourceUrl}\n${s.github!.path}`, s]),
  );

  const source = {
    sourceUrlKey,
    repository: repo.full_name,
    repoUrl: repo.html_url,
    defaultBranch: repo.default_branch,
    ref: resolved.ref,
    rootPath: resolved.rootPath,
    commitSha: resolved.commit.sha,
    licenseName: repo.license?.name ?? undefined,
    licenseSpdxId: repo.license?.spdx_id ?? repo.license?.key ?? undefined,
    skills: [] as GitHubSkillPreviewItem[],
    warnings,
    truncated: tree.truncated || skillPaths.length > MAX_SKILLS_PER_SOURCE,
  };

  const loadedSkills: LoadedGitHubSkill[] = [];
  for (const skillPath of limitedPaths) {
    if (selectedPaths && !selectedPaths.has(skillPath)) continue;
    try {
      loadedSkills.push(await loadGitHubSkill(
        parsedUrl.owner,
        parsedUrl.repo,
        resolved.commit.sha,
        source,
        tree,
        skillPath,
        occupiedNames,
        bySourcePath,
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (selectedPaths) throw new Error(`${skillPath} 加载失败: ${message}`);
      warnings.push(`${skillPath} 加载失败，已跳过: ${message}`);
    }
  }

  const previewSkills = selectedPaths
    ? limitedPaths
      .map((skillPath) => loadedSkills.find((s) => s.item.path === skillPath)?.item)
      .filter((item): item is GitHubSkillPreviewItem => Boolean(item))
    : loadedSkills.map((s) => s.item);

  return {
    preview: { ...source, skills: previewSkills },
    skills: loadedSkills,
  };
}

async function loadGitHubSkill(
  owner: string,
  repo: string,
  ref: string,
  source: SourceMeta,
  tree: GitHubTreeResponse,
  skillPath: string,
  occupiedNames: Set<string>,
  bySourcePath: Map<string, Skill>,
): Promise<LoadedGitHubSkill> {
  const warnings: string[] = [];
  const content = await fetchGitHubContent(owner, repo, ref, skillPath);
  if (content.length > MAX_SKILL_BYTES) {
    throw new Error(`${skillPath} 过大，已停止导入 (${content.length} bytes)`);
  }

  const parsed = parseSkillDoc(content, skillPath);
  const resourceBundle = await fetchResourceBundle(owner, repo, ref, tree, skillPath, parsed.body);
  warnings.push(...resourceBundle.warnings);

  const existing = bySourcePath.get(`${source.sourceUrlKey}\n${skillPath}`);
  const importName = existing?.name ?? createUniqueSkillName(parsed.name, occupiedNames);
  occupiedNames.add(importName);

  const instructions = buildImportedInstructions({ source, skillPath, parsed, resources: resourceBundle });
  const github: SkillGithubMeta = {
    sourceUrl: source.sourceUrlKey,
    repository: source.repository,
    path: skillPath,
    commitSha: source.commitSha,
    license: source.licenseSpdxId ?? source.licenseName ?? '',
    version: parsed.version,
  };
  const skill: Skill = {
    name: importName,
    description: parsed.description,
    instructions,
    source: 'custom',
    memoryEnabled: false,
    enabled: existing?.enabled ?? true,
    github,
  };

  const item: GitHubSkillPreviewItem = {
    path: skillPath,
    name: parsed.name,
    importName,
    description: parsed.description,
    version: parsed.version,
    bytes: content.length + resourceBundle.included.reduce((sum, file) => sum + file.bytes, 0),
    bodyBytes: content.length,
    includedFiles: resourceBundle.included.map(({ content: _content, ...file }) => file),
    omittedFiles: resourceBundle.omitted,
    warnings,
    nameChanged: importName !== parsed.name,
    existingSkillName: existing?.name,
  };

  return { item, skill };
}

// ---- URL 解析 ----

export function parseGitHubUrl(input: string): ParsedGitHubUrl {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('GitHub 链接不能为空');

  const shorthand = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?$/);
  if (shorthand) {
    return {
      owner: shorthand[1],
      repo: stripGitSuffix(shorthand[2]),
      mode: 'repo',
      path: '',
      url: `https://github.com/${shorthand[1]}/${stripGitSuffix(shorthand[2])}`,
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('请输入 GitHub 仓库、目录或 SKILL.md 链接');
  }

  if (url.hostname === 'raw.githubusercontent.com') {
    const [owner, repo, ...refPathParts] = url.pathname.split('/').filter(Boolean);
    if (!owner || !repo || refPathParts.length < 2) throw new Error('raw GitHub 链接缺少仓库或路径');
    const [ref, ...pathParts] = refPathParts;
    const path = pathParts.join('/');
    return {
      owner,
      repo: stripGitSuffix(repo),
      mode: path.endsWith('SKILL.md') ? 'blob' : 'tree',
      ref,
      path,
      refPathParts,
      url: trimmed,
    };
  }

  if (url.hostname !== 'github.com') throw new Error('目前只支持 github.com 或 raw.githubusercontent.com 链接');

  const [owner, rawRepo, action, ...rest] = url.pathname.split('/').filter(Boolean);
  if (!owner || !rawRepo) throw new Error('GitHub 链接缺少 owner/repo');
  const repo = stripGitSuffix(rawRepo);

  if (action === 'tree' || action === 'blob') {
    if (rest.length === 0) throw new Error('GitHub tree/blob 链接缺少分支');
    return {
      owner,
      repo,
      mode: action,
      ref: rest[0],
      path: rest.slice(1).join('/'),
      refPathParts: rest,
      url: trimmed,
    };
  }

  return { owner, repo, mode: 'repo', path: '', url: trimmed };
}

async function resolveSourceLocation(
  parsed: ParsedGitHubUrl,
  defaultBranch: string,
): Promise<{ ref: string; rootPath: string; commit: GitHubCommitResponse }> {
  const candidates = createSourceLocationCandidates(parsed, defaultBranch);
  for (const candidate of candidates) {
    const commit = await fetchOptionalGitHubJson<GitHubCommitResponse>(
      `/repos/${parsed.owner}/${parsed.repo}/commits/${encodeURIComponent(candidate.ref)}`,
    );
    if (commit) return { ...candidate, commit };
  }
  throw new Error('GitHub 链接中的分支、标签或提交不存在');
}

function createSourceLocationCandidates(
  parsed: ParsedGitHubUrl,
  defaultBranch: string,
): Array<{ ref: string; rootPath: string }> {
  if (parsed.mode === 'repo') {
    return [{ ref: parsed.ref ?? defaultBranch, rootPath: trimSlashes(parsed.path) }];
  }

  const parts = parsed.refPathParts?.filter(Boolean) ?? [];
  if (parts.length === 0) return [{ ref: defaultBranch, rootPath: trimSlashes(parsed.path) }];

  const candidates: Array<{ ref: string; rootPath: string }> = [];
  const defaultBranchParts = defaultBranch.split('/').filter(Boolean);
  if (startsWithSegments(parts, defaultBranchParts)) {
    candidates.push({ ref: defaultBranch, rootPath: parts.slice(defaultBranchParts.length).join('/') });
  }
  for (let refLength = parts.length; refLength >= 1; refLength -= 1) {
    candidates.push({ ref: parts.slice(0, refLength).join('/'), rootPath: parts.slice(refLength).join('/') });
  }
  return dedupeSourceLocationCandidates(candidates);
}

function findSkillPaths(tree: GitHubTreeResponse, rootPath: string, mode: ParsedGitHubUrl['mode']): string[] {
  const normalizedRoot = trimSlashes(rootPath);
  if (mode === 'blob') {
    if (!normalizedRoot.endsWith('SKILL.md')) throw new Error('单文件导入只支持 SKILL.md');
    if (!tree.tree.some((entry) => entry.type === 'blob' && entry.path === normalizedRoot)) {
      throw new Error(`GitHub 源中不存在 ${normalizedRoot}`);
    }
    return [normalizedRoot];
  }

  const prefix = normalizedRoot ? `${normalizedRoot}/` : '';
  return tree.tree
    .filter((entry) => entry.type === 'blob')
    .map((entry) => entry.path)
    .filter((path) => path === `${prefix}SKILL.md` || (path.startsWith(prefix) && path.endsWith('/SKILL.md')))
    .sort((a, b) => a.localeCompare(b));
}

// ---- 资源合并 ----

interface ResourceBundle {
  included: Array<{ path: string; bytes: number; content: string }>;
  omitted: Array<{ path: string; bytes: number }>;
  warnings: string[];
}

async function fetchResourceBundle(
  owner: string,
  repo: string,
  ref: string,
  tree: GitHubTreeResponse,
  skillPath: string,
  skillBody: string,
): Promise<ResourceBundle> {
  const directory = parentDirectory(skillPath);
  const candidates = tree.tree
    .filter((entry) => entry.type === 'blob')
    .filter((entry) => directory ? entry.path.startsWith(`${directory}/`) : !entry.path.includes('/'))
    .filter((entry) => entry.path !== skillPath)
    .filter((entry) => isTextResource(entry.path))
    .sort((a, b) => rankResource(a.path, skillBody) - rankResource(b.path, skillBody) || a.path.localeCompare(b.path));

  const included: ResourceBundle['included'] = [];
  const omitted: ResourceBundle['omitted'] = [];
  const warnings: string[] = [];
  let totalBytes = 0;

  for (const candidate of candidates) {
    const size = candidate.size ?? 0;
    if (included.length >= MAX_RESOURCE_FILES_PER_SKILL) {
      omitted.push({ path: candidate.path, bytes: size });
      continue;
    }
    if (size > MAX_RESOURCE_FILE_BYTES) {
      omitted.push({ path: candidate.path, bytes: size });
      warnings.push(`${candidate.path} 超过单文件资源上限，未合并`);
      continue;
    }
    if (totalBytes + size > MAX_RESOURCE_BYTES_PER_SKILL) {
      omitted.push({ path: candidate.path, bytes: size });
      continue;
    }
    const content = await fetchGitHubContent(owner, repo, ref, candidate.path);
    const contentBytes = new TextEncoder().encode(content).length;
    totalBytes += contentBytes;
    included.push({ path: candidate.path, bytes: contentBytes, content });
  }

  if (omitted.length > 0) warnings.push(`有 ${omitted.length} 个同目录资源未合并，可在上游仓库中查看`);
  return { included, omitted, warnings };
}

function buildImportedInstructions(input: {
  source: SourceMeta;
  skillPath: string;
  parsed: ParsedSkillDoc;
  resources: ResourceBundle;
}): string {
  const { source, skillPath, parsed, resources } = input;
  const header = [
    `# GitHub Skill: ${parsed.name}`,
    '',
    '## Gemini++ Import Metadata',
    '',
    `- Source: ${source.repository}`,
    `- Path: ${skillPath}`,
    `- Ref: ${source.ref}`,
    `- Commit: ${source.commitSha}`,
    `- License: ${source.licenseSpdxId ?? source.licenseName ?? 'Unknown'}`,
    parsed.version ? `- Upstream version: ${parsed.version}` : '',
    `- Bundled supporting files: ${resources.included.length}`,
    resources.omitted.length > 0 ? `- Omitted supporting files: ${resources.omitted.length}` : '',
  ].filter(Boolean).join('\n');

  const body = ['## Upstream SKILL.md', '', parsed.body.trim()].join('\n');

  const resourceDocs = resources.included.length === 0 ? '' : [
    '## Bundled Supporting Files',
    '',
    '这些文件来自同一个上游 Skill 目录，用于补齐原始 SKILL.md 中引用的 agents、references、templates 或 examples。',
    '',
    ...resources.included.map((resource) => [`### ${resource.path}`, '', resource.content.trim()].join('\n')),
  ].join('\n\n');

  const omitted = resources.omitted.length === 0 ? '' : [
    '## Omitted Supporting Files',
    '',
    '以下文件因为数量或大小限制没有合并进 prompt；需要时请参考上游仓库。',
    '',
    ...resources.omitted.map((file) => `- ${file.path} (${file.bytes} bytes)`),
  ].join('\n');

  return [header, body, resourceDocs, omitted].filter(Boolean).join('\n\n---\n\n');
}

// ---- SKILL.md 解析 ----

export function parseSkillDoc(raw: string, path: string): ParsedSkillDoc {
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = frontmatter ? parseYamlSubset(frontmatter[1]) : {};
  const body = frontmatter ? raw.slice(frontmatter[0].length).trim() : raw.trim();
  const rawName = readString(meta, 'name')
    ?? (parentDirectory(path).split('/').pop()
      || path.replace(/\/?SKILL\.md$/, '')
      || 'imported-skill');
  let name: string;
  try {
    name = normalizeSkillName(rawName);
  } catch {
    // 非 ASCII / 无法规范化的名称（如中文 frontmatter name）回退到占位名
    name = 'imported-skill';
  }
  const description = readString(meta, 'description') ?? firstParagraph(body) ?? `Imported GitHub Skill from ${path}`;
  const version = readString(meta, 'version');
  return { name, description, body, version };
}

function parseYamlSubset(raw: string): Record<string, unknown> {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const result: Record<string, unknown> = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2] ?? '';
    if (value === '|' || value === '|-' || value === '>' || value === '>-') {
      const block: string[] = [];
      while (i + 1 < lines.length && /^(\s+|$)/.test(lines[i + 1])) {
        i += 1;
        block.push(lines[i].replace(/^\s{2,}/, ''));
      }
      result[key] = value.startsWith('>') ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim();
      continue;
    }
    if (value === '') {
      const nested: Record<string, string> = {};
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
        i += 1;
        const nestedMatch = lines[i].match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
        if (nestedMatch) nested[nestedMatch[1]] = cleanYamlScalar(nestedMatch[2]);
      }
      result[key] = nested;
      continue;
    }
    result[key] = cleanYamlScalar(value);
  }
  return result;
}

function cleanYamlScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// ---- GitHub 请求 ----

async function fetchGitHubContent(owner: string, repo: string, ref: string, path: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(createGitHubRawUrl(owner, repo, ref, path), {
      signal: controller.signal,
      redirect: 'error',
      headers: { accept: 'text/plain, application/octet-stream' },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`GitHub raw content request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 180)}` : ''}`);
    }
    return await response.text();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('GitHub raw content request timed out');
    }
    if (error instanceof TypeError) {
      throw new Error('无法访问 GitHub raw 内容，请授予 raw.githubusercontent.com 访问权限并确认网络可用');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGitHubJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${GITHUB_API_BASE}${path}`, {
      signal: controller.signal,
      redirect: 'error',
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if ((response.status === 403 || response.status === 429) && /rate limit/i.test(detail)) {
        throw new Error('GitHub API rate limit exceeded，请稍等重试');
      }
      throw new Error(`GitHub 请求失败 (HTTP ${response.status})${detail ? `: ${detail.slice(0, 180)}` : ''}`);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('GitHub 请求超时');
    }
    if (error instanceof TypeError) {
      throw new Error('无法访问 GitHub API，请先授予 GitHub 访问权限并确认网络可用');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOptionalGitHubJson<T>(path: string): Promise<T | null> {
  try {
    return await fetchGitHubJson<T>(path);
  } catch (error) {
    if (isGitHubHttpStatus(error, 404)) return null;
    throw error;
  }
}

function isGitHubHttpStatus(error: unknown, status: number): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`HTTP ${status}`);
}

function createGitHubRawUrl(owner: string, repo: string, ref: string, path: string): string {
  return [
    GITHUB_RAW_BASE,
    encodeURIComponent(owner),
    encodeURIComponent(repo),
    encodeURIComponent(ref),
    ...path.split('/').map(encodeURIComponent),
  ].join('/');
}

// ---- 工具函数 ----

function isTextResource(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  const index = name.lastIndexOf('.');
  const ext = index >= 0 ? name.slice(index).toLowerCase() : '';
  return TEXT_RESOURCE_EXTENSIONS.has(ext);
}

function rankResource(path: string, skillBody: string): number {
  const relativeName = path.split('/').slice(-2).join('/');
  if (skillBody.includes(path) || skillBody.includes(relativeName)) return 0;
  if (path.includes('/agents/')) return 1;
  if (path.includes('/references/')) return 2;
  if (path.includes('/templates/')) return 3;
  if (path.includes('/examples/')) return 4;
  return 5;
}

function firstParagraph(body: string): string | undefined {
  const paragraph = body
    .replace(/^# .+$/m, '')
    .split(/\n\s*\n/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .find((part) => part.length > 0 && !part.startsWith('```'));
  return paragraph ? paragraph.slice(0, 240) : undefined;
}

function startsWithSegments(parts: string[], prefix: string[]): boolean {
  return prefix.length > 0 && prefix.every((part, index) => parts[index] === part);
}

function dedupeSourceLocationCandidates(
  candidates: Array<{ ref: string; rootPath: string }>,
): Array<{ ref: string; rootPath: string }> {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.ref}\n${candidate.rootPath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeSourceUrl(url: string): string {
  return stripGitSuffix(url.replace(/\/+$/, ''));
}

function stripGitSuffix(value: string): string {
  return value.replace(/\.git$/, '');
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function parentDirectory(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

function normalizeSkillName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!normalized) throw new Error('GitHub Skill 缺少有效名称');
  return normalized;
}

function createUniqueSkillName(preferred: string, occupiedNames: Set<string>): string {
  const normalized = normalizeSkillName(preferred);
  if (!occupiedNames.has(normalized)) return normalized;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${normalized}-${suffix}`;
    if (!occupiedNames.has(candidate)) return candidate;
  }
  throw new Error(`无法为远程 Skill 生成唯一名称: ${preferred}`);
}
