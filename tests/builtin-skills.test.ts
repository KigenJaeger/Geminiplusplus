import { describe, expect, it } from 'vitest';
import { BUILTIN_SKILLS } from '../core/skill/store';
import { isMemorySkill } from '../core/skill/memory';
import { buildAugmentedPrompt } from '../core/prompt/augmentation';

const memorySkill = BUILTIN_SKILLS.find((s) => s.name === 'global-memory');

describe('内置 global-memory 技能', () => {
  it('存在且标记为内置', () => {
    expect(memorySkill).toBeDefined();
    expect(memorySkill!.source).toBe('builtin');
  });

  it('显式开启记忆写入，不依赖关键词猜测', () => {
    expect(memorySkill!.memoryWriteEnabled).toBe(true);
    expect(isMemorySkill(memorySkill!)).toBe(true);
  });

  it('开启记忆读取，以便模型判断新增还是冲突', () => {
    expect(memorySkill!.memoryEnabled).toBe(true);
  });

  it('是唯一开启记忆读取的内置技能', () => {
    const withMemoryRead = BUILTIN_SKILLS.filter((s) => s.memoryEnabled).map((s) => s.name);
    expect(withMemoryRead).toEqual(['global-memory']);
  });

  it('调用时注入技能指令并保留正文作为可见文本', () => {
    const result = buildAugmentedPrompt('/global-memory 我常用 TypeScript 和 pnpm', {
      memories: [],
      skills: BUILTIN_SKILLS.map((s) => ({ ...s, enabled: true })),
      activePreset: null,
      activeProject: null,
      messageCount: 0,
      memoryEnabled: true,
      presetEnabled: false,
      presetCadence: 'off',
    });
    expect(result.activatedSkill?.name).toBe('global-memory');
    expect(result.visibleUserText).toBe('我常用 TypeScript 和 pnpm');
    expect(result.augmentedText).toContain('【技能 global-memory】');
  });

  it('调用时会连带注入已有记忆，供模型比对冲突', () => {
    const result = buildAugmentedPrompt('/global-memory 我改用 npm 了', {
      memories: [{ id: 1, name: 'global-memory', description: '', content: '我常用 pnpm' }],
      skills: BUILTIN_SKILLS.map((s) => ({ ...s, enabled: true })),
      activePreset: null,
      activeProject: null,
      messageCount: 1,
      memoryEnabled: true,
      presetEnabled: false,
      presetCadence: 'off',
    });
    expect(result.augmentedText).toContain('我常用 pnpm');
    expect(result.usedMemoryIds).toEqual([1]);
  });

  it('内置技能名唯一', () => {
    const names = BUILTIN_SKILLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
