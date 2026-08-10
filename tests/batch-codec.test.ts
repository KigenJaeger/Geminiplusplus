import { describe, expect, it } from 'vitest';
import { rewritePromptInBatchBody } from '../core/gemini/batch-codec';

// 构造一个近似 Gemini batchexecute 的请求体：f.req 是 URL 编码的 JSON 数组，
// 用户 prompt 嵌在内层字符串化 JSON 里。
function makeBody(prompt: string): string {
  const inner = JSON.stringify([[prompt], null, ['c_id', 'r_id']]);
  const freq = JSON.stringify([[['abcd', inner, null, 'generic']]]);
  const params = new URLSearchParams();
  params.set('f.req', freq);
  params.set('at', 'token123');
  return params.toString();
}

describe('rewritePromptInBatchBody', () => {
  it('替换嵌套字符串化 JSON 里的用户原文', () => {
    const body = makeBody('你好');
    const out = rewritePromptInBatchBody(body, '你好', '【系统规则】…\n\n用户问题：你好');
    expect(out).not.toBeNull();
    expect(out).toContain(encodeURIComponent('系统规则'));
    // at 字段保持不变
    expect(new URLSearchParams(out!).get('at')).toBe('token123');
    // 增强文本能被完整取回
    const freq = JSON.parse(new URLSearchParams(out!).get('f.req')!);
    const innerStr = freq[0][0][1] as string;
    expect(JSON.parse(innerStr)[0][0]).toContain('用户问题：你好');
  });

  it('去空白后相等也能命中', () => {
    const body = makeBody('  hello  ');
    const out = rewritePromptInBatchBody(body, 'hello', 'AUG hello');
    expect(out).not.toBeNull();
  });

  it('找不到原文时返回 null（绝不破坏请求）', () => {
    const body = makeBody('你好');
    const out = rewritePromptInBatchBody(body, '不存在的文本', 'x');
    expect(out).toBeNull();
  });

  it('替换带元数据包装的普通文本时保留包装内容', () => {
    const body = makeBody('prefix: 你好 :suffix');
    const out = rewritePromptInBatchBody(body, '你好', '增强版你好');
    expect(out).not.toBeNull();
    const freq = JSON.parse(new URLSearchParams(out!).get('f.req')!);
    const innerStr = freq[0][0][1] as string;
    expect(JSON.parse(innerStr)[0][0]).toBe('prefix: 增强版你好 :suffix');
  });

  it('原文与增强文本相同时返回 null', () => {
    const body = makeBody('你好');
    const out = rewritePromptInBatchBody(body, '你好', '你好');
    expect(out).toBeNull();
  });

  it('非 batchexecute 请求体（无 f.req）返回 null', () => {
    const out = rewritePromptInBatchBody('foo=bar&baz=1', '你好', 'x');
    expect(out).toBeNull();
  });

  // 输入框是 contenteditable：技能弹窗插入 `/name ` 的尾随空格会变成 NBSP，
  // Gemini 组装请求体时又可能规范化回普通空格。差一个字符就失配，
  // 表现为"技能完全不起作用"。
  it('输入框 NBSP 与请求体普通空格之间的差异不影响命中', () => {
    const body = makeBody('/ultra-think 测试内容');
    const original = '/ultra-think 测试内容';
    const out = rewritePromptInBatchBody(body, original, 'AUG');
    expect(out).not.toBeNull();
  });

  it('反向：请求体是 NBSP、输入框是普通空格也能命中', () => {
    const body = makeBody('/ultra-think 测试内容');
    const out = rewritePromptInBatchBody(body, '/ultra-think 测试内容', 'AUG');
    expect(out).not.toBeNull();
  });

  it('零宽字符差异不影响命中', () => {
    const body = makeBody('你好​世界');
    const out = rewritePromptInBatchBody(body, '你好世界', 'AUG');
    expect(out).not.toBeNull();
  });

  it('折叠多个空格后相等也能命中', () => {
    const body = makeBody('hello    world');
    const out = rewritePromptInBatchBody(body, 'hello world', 'AUG');
    expect(out).not.toBeNull();
  });

  it('字段包含前后文且空白不同也能替换原文', () => {
    const body = makeBody('request prefix: /translate-expert  hello world :suffix');
    const out = rewritePromptInBatchBody(body, '/translate-expert hello world', 'AUG');
    expect(out).not.toBeNull();
    const freq = JSON.parse(new URLSearchParams(out!).get('f.req')!);
    const innerStr = freq[0][0][1] as string;
    expect(JSON.parse(innerStr)[0][0]).toBe('request prefix: AUG :suffix');
  });

  it('归一化不会把不同文本误判为同一条', () => {
    const body = makeBody('你好世界');
    const out = rewritePromptInBatchBody(body, '你好 地球', 'AUG');
    expect(out).toBeNull();
  });
});
