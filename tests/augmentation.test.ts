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
