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
});
