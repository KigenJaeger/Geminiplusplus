import { describe, expect, it } from 'vitest';
import { buildAugmentedPrompt, parseSkillCommand } from '../core/prompt/augmentation';

const skill = {
  name: 'ultra-think',
  description: '极致思考',
  instructions: 'Reasoning Effort: Absolute maximum.',
  enabled: true,
  memoryEnabled: false,
};

const memory = {
  id: 1,
  name: '用户偏好',
  description: '工作相关',
  content: '用户喜欢简洁回答',
};

describe('parseSkillCommand', () => {
  it('解析 /技能名', () => {
    expect(parseSkillCommand('/ultra-think 帮我分析')).toEqual({
      skillName: 'ultra-think',
      args: '帮我分析',
      rawInput: '/ultra-think 帮我分析',
    });
  });

  it('忽略普通文本', () => {
    expect(parseSkillCommand('你好')).toBeNull();
  });

  it('支持中文和点号技能名', () => {
    expect(parseSkillCommand('/写作助手 改写这段话')).toMatchObject({
      skillName: '写作助手',
      args: '改写这段话',
    });
    expect(parseSkillCommand('/skill.creator 创建技能')).toMatchObject({
      skillName: 'skill.creator',
      args: '创建技能',
    });
  });

  it('按已知技能名最长匹配带空格的名称', () => {
    expect(parseSkillCommand('/Web Search 查找资料', ['web', 'Web Search'])).toEqual({
      skillName: 'web search',
      args: '查找资料',
      rawInput: '/Web Search 查找资料',
    });
  });

  it('已知技能列表不匹配时返回 null', () => {
    expect(parseSkillCommand('/unknown 内容', ['ultra-think'])).toBeNull();
  });
});

describe('buildAugmentedPrompt', () => {
  it('激活技能时注入技能指令并去掉命令前缀', () => {
    const result = buildAugmentedPrompt('/ultra-think 帮我分析这个问题', {
      memories: [],
      skills: [skill],
      activePreset: null,
      messageCount: 0,
      memoryEnabled: true,
      presetEnabled: false,
      presetCadence: 'first_message',
    });
    expect(result.activatedSkill?.name).toBe('ultra-think');
    expect(result.visibleUserText).toBe('帮我分析这个问题');
    expect(result.augmentedText).toContain('Reasoning Effort: Absolute maximum.');
    expect(result.augmentedText).toContain('帮我分析这个问题');
    expect(result.augmentedText).toContain('用户问题：帮我分析这个问题');
    expect(result.augmentedText).toContain('【Gemini++ 系统规则】');
  });

  it('技能 memoryEnabled=false 时跳过记忆注入', () => {
    const result = buildAugmentedPrompt('/ultra-think 问题', {
      memories: [memory],
      skills: [skill],
      activePreset: null,
      messageCount: 0,
      memoryEnabled: true,
      presetEnabled: false,
      presetCadence: 'first_message',
    });
    expect(result.usedMemoryIds).toEqual([]);
    expect(result.augmentedText).not.toContain('用户喜欢简洁回答');
  });

  it('带空格的技能名可以激活并移除完整命令前缀', () => {
    const spacedSkill = { ...skill, name: 'Web Search', instructions: 'Search the web.' };
    const result = buildAugmentedPrompt('/Web Search 查询 Gemini', {
      memories: [],
      skills: [spacedSkill],
      activePreset: null,
      messageCount: 0,
      memoryEnabled: true,
      presetEnabled: false,
      presetCadence: 'first_message',
    });
    expect(result.activatedSkill?.name).toBe('Web Search');
    expect(result.visibleUserText).toBe('查询 Gemini');
    expect(result.augmentedText).toContain('Search the web.');
  });

  it('后续不带命令的消息继续注入当前 Skill', () => {
    const continuedSkill = { ...skill, instructions: 'Keep asking clarifying questions.' };
    const result = buildAugmentedPrompt('这是补充信息', {
      memories: [],
      skills: [continuedSkill],
      activePreset: null,
      messageCount: 1,
      memoryEnabled: true,
      presetEnabled: false,
      presetCadence: 'off',
      activeSkillName: 'ultra-think',
    });
    expect(result.activatedSkill?.name).toBe('ultra-think');
    expect(result.visibleUserText).toBe('这是补充信息');
    expect(result.augmentedText).toContain('Keep asking clarifying questions.');
  });

  it('新的 /技能名 命令会切换持续 Skill', () => {
    const nextSkill = { ...skill, name: 'grill-me', instructions: 'Keep interviewing the user.' };
    const result = buildAugmentedPrompt('/grill-me 继续', {
      memories: [],
      skills: [skill, nextSkill],
      activePreset: null,
      messageCount: 1,
      memoryEnabled: true,
      presetEnabled: false,
      presetCadence: 'off',
      activeSkillName: 'ultra-think',
    });
    expect(result.activatedSkill?.name).toBe('grill-me');
    expect(result.visibleUserText).toBe('继续');
    expect(result.augmentedText).toContain('Keep interviewing the user.');
  });

  it('没有持续 Skill 时普通消息不添加技能块', () => {
    const result = buildAugmentedPrompt('继续说明', {
      memories: [],
      skills: [skill],
      activePreset: null,
      messageCount: 1,
      memoryEnabled: true,
      presetEnabled: false,
      presetCadence: 'off',
      activeSkillName: null,
    });
    expect(result.activatedSkill).toBeNull();
    expect(result.augmentedText).toBe('继续说明');
  });

  it('无技能命令且记忆开启时注入记忆', () => {
    const result = buildAugmentedPrompt('普通问题', {
      memories: [memory],
      skills: [skill],
      activePreset: null,
      messageCount: 0,
      memoryEnabled: true,
      presetEnabled: false,
      presetCadence: 'first_message',
    });
    expect(result.usedMemoryIds).toEqual([1]);
    expect(result.augmentedText).toContain('用户喜欢简洁回答');
  });

  it('预设仅首条消息注入', () => {
    const preset = { id: 'p1', name: '翻译', content: '你是一名专业译者' };
    const first = buildAugmentedPrompt('问题', {
      memories: [], skills: [], activePreset: preset, messageCount: 0,
      memoryEnabled: true, presetEnabled: true, presetCadence: 'first_message',
    });
    expect(first.augmentedText).toContain('你是一名专业译者');

    const second = buildAugmentedPrompt('问题2', {
      memories: [], skills: [], activePreset: preset, messageCount: 1,
      memoryEnabled: true, presetEnabled: true, presetCadence: 'first_message',
    });
    expect(second.augmentedText).toBe('问题2');
  });

  it('无任何注入内容时原样返回', () => {
    const result = buildAugmentedPrompt('普通问题', {
      memories: [], skills: [], activePreset: null, messageCount: 0,
      memoryEnabled: true, presetEnabled: false, presetCadence: 'first_message',
    });
    expect(result.augmentedText).toBe('普通问题');
    expect(result.injectedBlocks).toEqual([]);
  });

  it('技能注入总开关关闭时不激活技能', () => {
    const result = buildAugmentedPrompt('/ultra-think 帮我分析', {
      memories: [], skills: [skill], activePreset: null, messageCount: 0,
      memoryEnabled: true, presetEnabled: false, presetCadence: 'off',
      skillInjectionEnabled: false,
    });
    expect(result.activatedSkill).toBeNull();
    expect(result.injectedBlocks).toEqual([]);
    expect(result.augmentedText).toBe('/ultra-think 帮我分析');
  });

  it('技能注入总开关开启时正常激活', () => {
    const result = buildAugmentedPrompt('/ultra-think 帮我分析', {
      memories: [], skills: [skill], activePreset: null, messageCount: 0,
      memoryEnabled: true, presetEnabled: false, presetCadence: 'off',
      skillInjectionEnabled: true,
    });
    expect(result.activatedSkill?.name).toBe('ultra-think');
  });

  it('总开关缺省视为开启（兼容旧调用方）', () => {
    const result = buildAugmentedPrompt('/ultra-think 帮我分析', {
      memories: [], skills: [skill], activePreset: null, messageCount: 0,
      memoryEnabled: true, presetEnabled: false, presetCadence: 'off',
    });
    expect(result.activatedSkill?.name).toBe('ultra-think');
  });

  it('关闭技能注入不影响记忆注入', () => {
    const result = buildAugmentedPrompt('普通问题', {
      memories: [memory], skills: [skill], activePreset: null, messageCount: 0,
      memoryEnabled: true, presetEnabled: false, presetCadence: 'off',
      skillInjectionEnabled: false,
    });
    expect(result.augmentedText).toContain('用户喜欢简洁回答');
  });

  it('激活项目时注入项目指令', () => {
    const result = buildAugmentedPrompt('继续开发', {
      memories: [], skills: [], activePreset: null, messageCount: 0,
      memoryEnabled: true, presetEnabled: false, presetCadence: 'first_message',
      activeProject: { name: 'Gemini++', description: '浏览器扩展', instructions: '保持 TypeScript 严格类型。' },
    });
    expect(result.augmentedText).toContain('【项目 Gemini++】');
    expect(result.augmentedText).toContain('保持 TypeScript 严格类型。');
  });
});
