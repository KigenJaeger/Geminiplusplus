import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importGitHubSkill, parseGitHubUrl, parseSkillDoc, previewGitHubSkill } from '../core/skill/github-importer';

// ---- mock 数据 ----

const REPO_INFO = {
  full_name: 'owner/skill-repo',
  html_url: 'https://github.com/owner/skill-repo',
  default_branch: 'main',
  license: { key: 'mit', spdx_id: 'MIT', name: 'MIT License' },
};

const TREE = {
  sha: 'tree-sha',
  truncated: false,
  tree: [
    { path: 'skills', type: 'tree' },
    { path: 'skills/alpha/SKILL.md', type: 'blob', size: 200 },
    { path: 'skills/alpha/references/guide.md', type: 'blob', size: 100 },
    { path: 'skills/alpha/references/notes.txt', type: 'blob', size: 50 },
    { path: 'skills/beta/SKILL.md', type: 'blob', size: 150 },
    { path: 'README.md', type: 'blob', size: 500 },
  ],
};

const SKILL_ALPHA = [
  '---',
  'name: alpha-writer',
  'description: 测试技能 A',
  'version: 1.2.0',
  '---',
  '# Alpha Writer',
  '这是一个测试技能，参考了 references/guide.md。',
].join('\n');

const SKILL_BETA = [
  '---',
  'name: beta-summarizer',
  'description: 测试技能 B',
  '---',
  '# Beta Summarizer',
  '汇总技能。',
].join('\n');

const COMMIT = { sha: 'commit-sha-123' };

type StorageMap = Map<string, unknown>;

function installMocks(): StorageMap {
  const storage: StorageMap = new Map();

  globalThis.chrome = {
    storage: {
      local: {
        async get(keys: string | string[]): Promise<Record<string, unknown>> {
          if (Array.isArray(keys)) {
            const result: Record<string, unknown> = {};
            for (const key of keys) result[key] = storage.get(key);
            return result;
          }
          return { [keys]: storage.get(keys) };
        },
        async set(items: Record<string, unknown>): Promise<void> {
          for (const [key, value] of Object.entries(items)) storage.set(key, value);
        },
      },
    },
  } as unknown as typeof chrome;

  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.startsWith('https://api.github.com/repos/owner/skill-repo')) {
      if (url.includes('/commits/')) return jsonResponse(COMMIT);
      if (url.includes('/git/trees/')) return jsonResponse(TREE);
      return jsonResponse(REPO_INFO);
    }
    if (url.startsWith('https://raw.githubusercontent.com/owner/skill-repo/')) {
      const path = url.replace('https://raw.githubusercontent.com/owner/skill-repo/commit-sha-123/', '');
      const content = path === 'skills/alpha/SKILL.md' ? SKILL_ALPHA
        : path === 'skills/beta/SKILL.md' ? SKILL_BETA
          : path === 'skills/alpha/references/guide.md' ? '# Guide\n说明文件。'
            : path === 'skills/alpha/references/notes.txt' ? 'notes'
              : '';
      return textResponse(content);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

  return storage;
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
}

function textResponse(text: string): Response {
  return new Response(text, { status: 200 });
}

function getCustomSkills(storage: StorageMap): unknown[] {
  return storage.get('gemini_pp_skills') as unknown[] ?? [];
}

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---- parseGitHubUrl ----

describe('parseGitHubUrl', () => {
  it('解析 owner/repo 简写', () => {
    expect(parseGitHubUrl('owner/repo')).toEqual({
      owner: 'owner', repo: 'repo', mode: 'repo', path: '', url: 'https://github.com/owner/repo',
    });
  });

  it('解析仓库根链接', () => {
    const parsed = parseGitHubUrl('https://github.com/owner/repo');
    expect(parsed.mode).toBe('repo');
    expect(parsed.owner).toBe('owner');
    expect(parsed.repo).toBe('repo');
  });

  it('解析 tree 目录链接', () => {
    const parsed = parseGitHubUrl('https://github.com/owner/repo/tree/main/skills/alpha');
    expect(parsed.mode).toBe('tree');
    expect(parsed.ref).toBe('main');
    expect(parsed.path).toBe('skills/alpha');
  });

  it('解析 blob 单文件链接', () => {
    const parsed = parseGitHubUrl('https://github.com/owner/repo/blob/main/skills/alpha/SKILL.md');
    expect(parsed.mode).toBe('blob');
    expect(parsed.path).toBe('skills/alpha/SKILL.md');
  });

  it('解析 raw.githubusercontent.com 链接', () => {
    const parsed = parseGitHubUrl('https://raw.githubusercontent.com/owner/repo/main/skills/alpha/SKILL.md');
    expect(parsed.mode).toBe('blob');
    expect(parsed.ref).toBe('main');
    expect(parsed.path).toBe('skills/alpha/SKILL.md');
  });

  it('拒绝非 GitHub 域名', () => {
    expect(() => parseGitHubUrl('https://example.com/owner/repo')).toThrow('目前只支持 github.com 或 raw.githubusercontent.com 链接');
  });

  it('拒绝非法链接', () => {
    expect(() => parseGitHubUrl('not-a-url')).toThrow('请输入 GitHub 仓库、目录或 SKILL.md 链接');
  });
});

// ---- parseSkillDoc ----

describe('parseSkillDoc', () => {
  it('解析 frontmatter 的 name/description/version', () => {
    const parsed = parseSkillDoc(SKILL_ALPHA, 'skills/alpha/SKILL.md');
    expect(parsed.name).toBe('alpha-writer');
    expect(parsed.description).toBe('测试技能 A');
    expect(parsed.version).toBe('1.2.0');
    expect(parsed.body).toContain('# Alpha Writer');
  });

  it('无 frontmatter 时从目录名推导名称', () => {
    const parsed = parseSkillDoc('# Plain\n没有 frontmatter。', 'skills/plain/SKILL.md');
    expect(parsed.name).toBe('plain');
  });

  it('根目录 SKILL.md 无 name 时回退为 imported-skill', () => {
    const parsed = parseSkillDoc('# Root\n根目录技能，无 frontmatter。', 'SKILL.md');
    expect(parsed.name).toBe('imported-skill');
  });

  it('中文 frontmatter name 无法规范化时回退为 imported-skill', () => {
    const parsed = parseSkillDoc('---\nname: 中文技能名\ndescription: 测试\n---\n正文', 'skills/cn/SKILL.md');
    expect(parsed.name).toBe('imported-skill');
  });
});

// ---- previewGitHubSkill / importGitHubSkill 端到端 ----

describe('GitHub Skill 导入', () => {
  it('预览仓库：找到全部 SKILL.md 并解析', async () => {
    installMocks();
    const preview = await previewGitHubSkill('owner/skill-repo');
    expect(preview.repository).toBe('owner/skill-repo');
    expect(preview.defaultBranch).toBe('main');
    expect(preview.commitSha).toBe(COMMIT.sha);
    expect(preview.skills.map((s) => s.path)).toEqual(['skills/alpha/SKILL.md', 'skills/beta/SKILL.md']);

    const alpha = preview.skills[0]!;
    expect(alpha.name).toBe('alpha-writer');
    expect(alpha.importName).toBe('alpha-writer');
    expect(alpha.description).toBe('测试技能 A');
    expect(alpha.version).toBe('1.2.0');
    expect(alpha.includedFiles.map((f) => f.path)).toEqual([
      'skills/alpha/references/guide.md',
      'skills/alpha/references/notes.txt',
    ]);
  });

  it('导入所选技能并写入存储', async () => {
    const storage = installMocks();
    const result = await importGitHubSkill({ url: 'owner/skill-repo', selectedPaths: ['skills/alpha/SKILL.md'] });
    expect(result.imported).toEqual([{ name: 'alpha-writer', path: 'skills/alpha/SKILL.md' }]);
    expect(result.replaced).toBe(0);

    const skills = getCustomSkills(storage) as Array<{ name: string; github: { repository: string; path: string } }>;
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('alpha-writer');
    expect(skills[0]!.github?.repository).toBe('owner/skill-repo');
    expect(skills[0]!.github?.path).toBe('skills/alpha/SKILL.md');
    // 资源文件已合并进指令
    expect(skills[0]!.github?.repository).toBeTruthy();
  });

  it('名称冲突时自动加后缀改名', async () => {
    const storage = installMocks();
    storage.set('gemini_pp_skills', [{ name: 'alpha-writer', description: '', instructions: '', source: 'custom', memoryEnabled: false }]);

    const result = await importGitHubSkill({ url: 'owner/skill-repo', selectedPaths: ['skills/alpha/SKILL.md'] });
    expect(result.imported[0]!.name).toBe('alpha-writer-2');
    expect(result.renamed).toBe(1);
    const skills = getCustomSkills(storage) as Array<{ name: string }>;
    expect(skills.map((s) => s.name)).toEqual(['alpha-writer', 'alpha-writer-2']);
  });

  it('同源同路径重导 = 覆盖更新，保留原名称', async () => {
    const storage = installMocks();
    await importGitHubSkill({ url: 'owner/skill-repo', selectedPaths: ['skills/alpha/SKILL.md'] });

    const result = await importGitHubSkill({ url: 'https://github.com/owner/skill-repo', selectedPaths: ['skills/alpha/SKILL.md'] });
    expect(result.replaced).toBe(1);
    expect(result.imported[0]!.name).toBe('alpha-writer');
    const skills = getCustomSkills(storage) as Array<{ name: string }>;
    expect(skills).toHaveLength(1);
  });

  it('空选择时报错', async () => {
    installMocks();
    await expect(importGitHubSkill({ url: 'owner/skill-repo', selectedPaths: [] })).rejects.toThrow('至少选择一个 Skill 后再导入');
  });

  it('不存在的仓库树报错', async () => {
    installMocks();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.includes('/git/trees/')) return jsonResponse({ sha: 'x', truncated: false, tree: [] });
      if (url.includes('/commits/')) return jsonResponse(COMMIT);
      return jsonResponse({ ...REPO_INFO, full_name: 'owner/empty' });
    });
    await expect(previewGitHubSkill('owner/empty')).rejects.toThrow('没有在这个 GitHub 链接下找到 SKILL.md');
  });

  it('预览时单个 Skill 加载失败被跳过并记入警告', async () => {
    installMocks();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.startsWith('https://api.github.com/repos/owner/skill-repo')) {
        if (url.includes('/commits/')) return jsonResponse(COMMIT);
        if (url.includes('/git/trees/')) return jsonResponse(TREE);
        return jsonResponse(REPO_INFO);
      }
      const path = url.replace('https://raw.githubusercontent.com/owner/skill-repo/commit-sha-123/', '');
      if (path === 'skills/alpha/SKILL.md') return textResponse(SKILL_ALPHA);
      if (path === 'skills/beta/SKILL.md') return new Response('not found', { status: 404 });
      return textResponse('');
    });

    const preview = await previewGitHubSkill('owner/skill-repo');
    expect(preview.skills.map((s) => s.path)).toEqual(['skills/alpha/SKILL.md']);
    expect(preview.warnings.some((w) => w.includes('skills/beta/SKILL.md'))).toBe(true);
  });

  it('导入时选中的 Skill 加载失败直接报错', async () => {
    installMocks();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.startsWith('https://api.github.com/repos/owner/skill-repo')) {
        if (url.includes('/commits/')) return jsonResponse(COMMIT);
        if (url.includes('/git/trees/')) return jsonResponse(TREE);
        return jsonResponse(REPO_INFO);
      }
      const path = url.replace('https://raw.githubusercontent.com/owner/skill-repo/commit-sha-123/', '');
      if (path === 'skills/beta/SKILL.md') return new Response('not found', { status: 404 });
      return textResponse('');
    });

    await expect(
      importGitHubSkill({ url: 'owner/skill-repo', selectedPaths: ['skills/beta/SKILL.md'] }),
    ).rejects.toThrow('skills/beta/SKILL.md 加载失败');
  });
});
