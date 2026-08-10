import { describe, expect, it } from 'vitest';
import { isMemorySkill } from '../core/skill/memory';

describe('isMemorySkill', () => {
  it('recognizes memory-related custom skills from metadata', () => {
    expect(isMemorySkill({ name: 'remember-preferences', description: '', instructions: '保存用户偏好' })).toBe(true);
    expect(isMemorySkill({ name: 'writer', description: '普通写作', instructions: '改写文本' })).toBe(false);
  });

  it('allows an explicit opt-in even without a keyword', () => {
    expect(isMemorySkill({ name: 'profile', description: '', instructions: '记录资料', memoryWriteEnabled: true })).toBe(true);
  });
});
