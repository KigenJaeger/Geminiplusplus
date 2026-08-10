import { describe, expect, it } from 'vitest';
import {
  FALLBACK_CONVERSATION_TITLE,
  isPlaceholderTitle,
  normalizeConversationTitle,
  sanitizeManualTitle,
  shouldSyncTitle,
} from '../core/project/title';

describe('sanitizeManualTitle', () => {
  it('保留用户名字里的「- Gemini」，不当站点后缀剥掉', () => {
    expect(sanitizeManualTitle('调试 - Gemini 注入问题')).toBe('调试 - Gemini 注入问题');
    expect(sanitizeManualTitle('Gemini')).toBe('Gemini');
  });

  it('压缩空白并裁掉两端', () => {
    expect(sanitizeManualTitle('  我的   命名  ')).toBe('我的 命名');
  });

  it('限制长度', () => {
    expect(sanitizeManualTitle('壹'.repeat(300))).toHaveLength(200);
  });

  it('纯空白返回空串，交给调用方拒绝', () => {
    expect(sanitizeManualTitle('   ')).toBe('');
  });
});

describe('normalizeConversationTitle', () => {
  it('剥掉站点后缀', () => {
    expect(normalizeConversationTitle('写个脚本 - Google Gemini')).toBe('写个脚本');
    expect(normalizeConversationTitle('Lazy Senior Dev Mode Review — Gemini')).toBe('Lazy Senior Dev Mode Review');
    expect(normalizeConversationTitle('某个话题 | Google Bard')).toBe('某个话题');
  });

  it('压缩空白并裁掉两端', () => {
    expect(normalizeConversationTitle('  多个   空格  ')).toBe('多个 空格');
  });

  it('没有后缀时原样返回', () => {
    expect(normalizeConversationTitle('skill开发')).toBe('skill开发');
  });

  it('限制长度', () => {
    expect(normalizeConversationTitle('壹'.repeat(300))).toHaveLength(200);
  });
});

describe('isPlaceholderTitle', () => {
  it('识别 Gemini 还没命名时的站点标题', () => {
    expect(isPlaceholderTitle('Google Gemini')).toBe(true);
    expect(isPlaceholderTitle('gemini')).toBe(true);
    expect(isPlaceholderTitle('Bard')).toBe(true);
    expect(isPlaceholderTitle('')).toBe(true);
    expect(isPlaceholderTitle('  ')).toBe(true);
    expect(isPlaceholderTitle(FALLBACK_CONVERSATION_TITLE)).toBe(true);
  });

  it('真实对话名不算占位', () => {
    expect(isPlaceholderTitle('skill开发')).toBe(false);
    expect(isPlaceholderTitle('Gemini 插件注入问题')).toBe(false);
  });
});

describe('shouldSyncTitle', () => {
  it('占位标题落库后，Gemini 命名了就同步', () => {
    expect(shouldSyncTitle({ storedTitle: FALLBACK_CONVERSATION_TITLE, incomingTitle: '写个脚本 - Google Gemini' })).toBe(true);
  });

  it('用户手动改过名就不再覆盖', () => {
    expect(shouldSyncTitle({ storedTitle: '我的命名', incomingTitle: '写个脚本', titleLocked: true })).toBe(false);
  });

  it('页面标题还是站点名时不同步', () => {
    expect(shouldSyncTitle({ storedTitle: FALLBACK_CONVERSATION_TITLE, incomingTitle: 'Google Gemini' })).toBe(false);
  });

  it('内容一致时不同步，避免无谓写入', () => {
    expect(shouldSyncTitle({ storedTitle: '写个脚本', incomingTitle: '写个脚本 - Google Gemini' })).toBe(false);
  });

  it('未锁定时允许跟随 Gemini 后来的改名', () => {
    expect(shouldSyncTitle({ storedTitle: '旧名字', incomingTitle: '新名字' })).toBe(true);
  });
});
