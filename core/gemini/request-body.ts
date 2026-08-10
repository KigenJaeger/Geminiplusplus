// 请求体归一化：把 fetch / XHR 可能传来的各种 body 形态读成字符串，改写后再还原成同类型。
//
// 为什么需要这层：Gemini 发消息的 body 不保证是 string。实际见过 URLSearchParams
// （Angular HttpClient 常见）、TypedArray（Closure 编码后）等形态。旧实现只处理
// `typeof body === 'string'`，其余形态被静默跳过，注入就永远不会发生。

export type NormalizedBodyKind = 'string' | 'urlSearchParams' | 'binary' | 'blob' | 'formData';

export interface NormalizedBody {
  text: string;
  kind: NormalizedBodyKind;
  /** formData 时保留原对象，还原时只替换 f.req 字段 */
  formData?: FormData;
  /** blob 时保留 MIME，还原时沿用 */
  blobType?: string;
}

/** 判断这个 body 是否是我们能同步读出的形态（XHR 钩子只能同步处理）。 */
export function readBodySync(body: unknown): NormalizedBody | null {
  if (typeof body === 'string') {
    return { text: body, kind: 'string' };
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return { text: body.toString(), kind: 'urlSearchParams' };
  }
  if (body instanceof ArrayBuffer) {
    return { text: new TextDecoder().decode(body), kind: 'binary' };
  }
  if (ArrayBuffer.isView(body)) {
    return { text: new TextDecoder().decode(body as Uint8Array), kind: 'binary' };
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const freq = body.get('f.req');
    if (typeof freq !== 'string') return null;
    // 用 f.req= 包一层，复用同一个 codec；还原时再拆回字段
    return { text: `f.req=${encodeURIComponent(freq)}`, kind: 'formData', formData: body };
  }
  return null;
}

/** fetch 钩子可用的异步版本，额外支持 Blob。 */
export async function readBodyAsync(body: unknown): Promise<NormalizedBody | null> {
  const sync = readBodySync(body);
  if (sync) return sync;
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return { text: await body.text(), kind: 'blob', blobType: body.type };
  }
  return null;
}

/** 把改写后的文本还原成与原 body 相同的类型。 */
export function restoreBody(normalized: NormalizedBody, text: string): BodyInit {
  switch (normalized.kind) {
    case 'urlSearchParams':
      return new URLSearchParams(text);
    case 'binary':
      return new TextEncoder().encode(text);
    case 'blob':
      return new Blob([text], { type: normalized.blobType || 'text/plain' });
    case 'formData': {
      const form = normalized.formData!;
      const freq = new URLSearchParams(text).get('f.req');
      if (freq !== null) form.set('f.req', freq);
      return form;
    }
    case 'string':
    default:
      return text;
  }
}
