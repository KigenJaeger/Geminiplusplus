import { describe, it, expect } from 'vitest';
import { readBodySync, readBodyAsync, restoreBody } from '../core/gemini/request-body';

describe('request-body 归一化', () => {
  it('string body 原样读出并还原', () => {
    const n = readBodySync('f.req=%5B%5D&at=x');
    expect(n).toEqual({ text: 'f.req=%5B%5D&at=x', kind: 'string' });
    expect(restoreBody(n!, 'f.req=1')).toBe('f.req=1');
  });

  it('URLSearchParams body 读出为字符串并还原为同类型', () => {
    const params = new URLSearchParams({ 'f.req': '["a"]', at: 'tok' });
    const n = readBodySync(params);
    expect(n?.kind).toBe('urlSearchParams');
    expect(n?.text).toContain('f.req=');
    const restored = restoreBody(n!, 'f.req=%5B%22b%22%5D&at=tok');
    expect(restored).toBeInstanceOf(URLSearchParams);
    expect((restored as URLSearchParams).get('f.req')).toBe('["b"]');
  });

  it('TypedArray body 解码并还原为字节', () => {
    const bytes = new TextEncoder().encode('f.req=%5B%5D');
    const n = readBodySync(bytes);
    expect(n?.kind).toBe('binary');
    expect(n?.text).toBe('f.req=%5B%5D');
    const restored = restoreBody(n!, 'f.req=%5B1%5D');
    expect(new TextDecoder().decode(restored as Uint8Array)).toBe('f.req=%5B1%5D');
  });

  it('FormData body 只替换 f.req 字段，保留 at', () => {
    const form = new FormData();
    form.set('f.req', '["hello"]');
    form.set('at', 'token-keep');
    const n = readBodySync(form);
    expect(n?.kind).toBe('formData');
    const restored = restoreBody(n!, `f.req=${encodeURIComponent('["bye"]')}`) as FormData;
    expect(restored.get('f.req')).toBe('["bye"]');
    expect(restored.get('at')).toBe('token-keep');
  });

  it('Blob body 只能异步读出', async () => {
    const blob = new Blob(['f.req=%5B%5D'], { type: 'text/plain' });
    expect(readBodySync(blob)).toBeNull();
    const n = await readBodyAsync(blob);
    expect(n?.kind).toBe('blob');
    expect(n?.text).toBe('f.req=%5B%5D');
  });

  it('无法识别的 body 返回 null', () => {
    expect(readBodySync(null)).toBeNull();
    expect(readBodySync(123)).toBeNull();
  });
});
