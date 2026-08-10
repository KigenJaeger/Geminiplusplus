import { describe, expect, it } from 'vitest';
import { detectSkillDraft } from '../core/skill/draft-detect';

const FENCED = [
  '这是给你的技能草稿：',
  '```markdown',
  '---',
  'name: Release Helper',
  'description: 整理发布说明',
  '---',
  '# Release Helper',
  '',
  '写简洁的发布说明。',
  '```',
  '点击“导入为 Skill”即可保存。',
].join('\n');

describe('detectSkillDraft 严格模式', () => {
  it('识别代码块里的 SKILL.md', () => {
    expect(detectSkillDraft(FENCED)).toMatchObject({
      name: 'release-helper',
      description: '整理发布说明',
      instructions: '# Release Helper\n\n写简洁的发布说明。',
    });
  });

  it('识别没有围栏的原始 Markdown', () => {
    const raw = '---\nname: my-skill\ndescription: 描述\n---\n正文内容';
    expect(detectSkillDraft(raw)).toMatchObject({ name: 'my-skill', instructions: '正文内容' });
  });

  it('波浪号围栏也认', () => {
    const raw = '~~~md\n---\nname: tilde-skill\ndescription: 描述\n---\n正文\n~~~';
    expect(detectSkillDraft(raw)?.name).toBe('tilde-skill');
  });

  it('yaml 语言标记也认', () => {
    const raw = '```yaml\n---\nname: yaml-skill\ndescription: 描述\n---\n正文\n```';
    expect(detectSkillDraft(raw)?.name).toBe('yaml-skill');
  });

  it('把名字规范成 slug', () => {
    const raw = '---\nname: My Cool Skill!!\ndescription: 描述\n---\n正文';
    expect(detectSkillDraft(raw)?.name).toBe('my-cool-skill');
  });

  it('去掉值上的引号', () => {
    const raw = '---\nname: "quoted-skill"\ndescription: \'带引号\'\n---\n正文';
    expect(detectSkillDraft(raw)).toMatchObject({ name: 'quoted-skill', description: '带引号' });
  });
});

describe('detectSkillDraft 宽松模式（--- 被渲染成 <hr> 冲掉）', () => {
  // Gemini 把代码块外的 --- 渲染成 <hr>，innerText 里只剩下 key: value 和正文
  const rendered = 'name: release-helper\ndescription: 整理发布说明\n# Release Helper\n\n写简洁的发布说明。';

  it('文本里有 skill 字样时启用', () => {
    const withWord = `这是一个 skill 草稿\n${rendered}`;
    expect(detectSkillDraft(withWord)).toMatchObject({
      name: 'release-helper',
      instructions: '# Release Helper\n\n写简洁的发布说明。',
    });
  });

  it('trusted（刚用过 /skill-creator）时即使没有 skill 字样也启用', () => {
    expect(detectSkillDraft(rendered, { trusted: true })?.name).toBe('release-helper');
    expect(detectSkillDraft(rendered)).toBeNull();
  });

  it('只有 name 一个键时不认，避免误判普通正文', () => {
    expect(detectSkillDraft('name: something\n正文', { trusted: true })).toBeNull();
  });

  it('name 出现得太靠后时不认', () => {
    const late = ['a: 1', 'b: 2', 'c: 3', 'd: 4', 'e: 5', 'f: 6', 'name: x', 'description: y', '正文'].join('\n');
    expect(detectSkillDraft(late, { trusted: true })).toBeNull();
  });

  it('遇到不认识的键就停止收集，当作正文开始', () => {
    const raw = 'name: my-skill\ndescription: 描述\nRandom: 这行不是 frontmatter\n正文';
    expect(detectSkillDraft(raw, { trusted: true })?.instructions).toBe('Random: 这行不是 frontmatter\n正文');
  });
});

describe('detectSkillDraft 拒绝无效输入', () => {
  it('空文本', () => {
    expect(detectSkillDraft('')).toBeNull();
    expect(detectSkillDraft('   ')).toBeNull();
  });

  it('普通回复不会被误判', () => {
    expect(detectSkillDraft('这是一段普通回复，讲了讲 skill 是什么。')).toBeNull();
  });

  it('带冒号的散文不会被误判', () => {
    expect(detectSkillDraft('Note: 这里说明一下 skill 的用法。\n然后继续写。')).toBeNull();
  });

  it('缺少正文', () => {
    expect(detectSkillDraft('---\nname: x\ndescription: y\n---\n')).toBeNull();
  });

  it('缺少 name', () => {
    expect(detectSkillDraft('---\ndescription: y\n---\n正文')).toBeNull();
  });

  it('name 规范化后为空', () => {
    expect(detectSkillDraft('---\nname: 中文名字\ndescription: y\n---\n正文')).toBeNull();
  });
});

describe('detectSkillDraft 多候选', () => {
  it('回复里有多个代码块时挑出真正的 SKILL.md', () => {
    const raw = [
      '先看个例子：',
      '```bash',
      'npm run build',
      '```',
      '草稿如下：',
      '```markdown',
      '---',
      'name: real-skill',
      'description: 真正的技能',
      '---',
      '# 真正的技能',
      '',
      '这里是完整正文，比其他候选长得多。',
      '```',
    ].join('\n');
    expect(detectSkillDraft(raw)?.name).toBe('real-skill');
  });

  it('正文最长的候选胜出', () => {
    const raw = [
      '```markdown',
      '---',
      'name: short-one',
      'description: 短',
      '---',
      '短',
      '```',
      '```markdown',
      '---',
      'name: long-one',
      'description: 长',
      '---',
      '这一份正文明显更完整更长，应该胜出。',
      '```',
    ].join('\n');
    expect(detectSkillDraft(raw)?.name).toBe('long-one');
  });
});
