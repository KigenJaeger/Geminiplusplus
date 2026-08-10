// Gemini batchexecute 请求体改写
//
// Gemini 网页版发消息走 POST 到 .../batchexecute?...，请求体是 application/x-www-form-urlencoded，
// 关键字段 f.req 是一个 URL 编码的 JSON 数组，用户的 prompt 文本是这个数组里某处的一个 JSON 字符串，
// 且常常还被再套一层字符串化 JSON。数组的确切形状会随 Gemini 版本变化、无法稳定依赖，
// 因此这里不写死"第几层第几个"，而是采用「按值查找替换」：
//   在解析出的结构里递归找到 === 用户原文（或去空白后相等）的字符串，就地替换成增强版。
// 只要原文找不到，就原样返回、绝不破坏请求。

/** 递归地把结构里等于 target 的字符串替换成 replacement；返回是否发生过替换。 */
function replaceStringDeep(
  value: unknown,
  matches: (s: string) => boolean,
  replacement: string,
  target: string,
): { value: unknown; replaced: boolean } {
  if (typeof value === 'string') {
    // 1) 直接命中
    if (matches(value)) return { value: replacement, replaced: true };
    // 2) 这个字符串本身是一段被嵌套的 JSON（Gemini 常见），进去再找
    if (looksLikeJson(value)) {
      try {
        const inner = JSON.parse(value);
        if (inner && typeof inner === 'object') {
          const res = replaceStringDeep(inner, matches, replacement, target);
          if (res.replaced) {
            return { value: JSON.stringify(res.value), replaced: true };
          }
        }
      } catch {
        /* 不是合法 JSON，忽略 */
      }
    }
    if (!looksLikeJson(value)) {
      const replacedValue = replaceEmbeddedText(value, target, replacement);
      if (replacedValue !== null) return { value: replacedValue, replaced: true };
    }
    return { value, replaced: false };
  }

  if (Array.isArray(value)) {
    let replaced = false;
    const next = value.map((item) => {
      const res = replaceStringDeep(item, matches, replacement, target);
      if (res.replaced) replaced = true;
      return res.value;
    });
    return { value: replaced ? next : value, replaced };
  }

  if (value && typeof value === 'object') {
    let replaced = false;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const res = replaceStringDeep(v, matches, replacement, target);
      if (res.replaced) replaced = true;
      next[k] = res.value;
    }
    return { value: replaced ? next : value, replaced };
  }

  return { value, replaced: false };
}

function looksLikeJson(s: string): boolean {
  const t = s.trim();
  return (t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 在较大的字段中查找原文，允许 Gemini 改写空白字符和插入零宽字符。 */
function replaceEmbeddedText(value: string, target: string, replacement: string): string | null {
  if (value.includes(target)) return value.replace(target, replacement);
  const normalizedTarget = normalizeWhitespace(target);
  if (!normalizedTarget) return null;
  const pattern = [...normalizedTarget]
    .map((char) => /\s/u.test(char)
      ? '[\\s\\u00a0]+'
      : `${escapeRegExp(char)}[\\u200b\\u200c\\u200d\\ufeff]*`)
    .join('');
  const match = new RegExp(pattern, 'u').exec(value);
  return match
    ? value.slice(0, match.index) + replacement + value.slice(match.index + match[0].length)
    : null;
}

/**
 * 空白归一化，用于容忍输入框文本与请求体文本之间的空白差异。
 *
 * 为什么需要：输入框是 contenteditable（Quill），技能弹窗插入 `/name ` 时尾随空格会
 * 变成 NBSP( )，Gemini 组装请求体时又可能把它规范化成普通空格。两者只要差一个
 * 字符，严格相等就失配，整条注入会静默跳过——表现为"技能完全不起作用"。
 */
function normalizeWhitespace(s: string): string {
  return s
    // 零宽字符直接删除（不能折叠成空格，否则会在原本相邻的字之间凭空插入空格）
    .replace(/[​‌‍﻿]/gu, '')
    // NBSP 及其余空白折叠成单个普通空格
    .replace(/[\s ]+/gu, ' ')
    .trim();
}

/**
 * 在一个 x-www-form-urlencoded 的请求体里，把 f.req 内的用户原文替换为增强版。
 * @returns 新的请求体字符串；若未找到原文/无法解析，返回 null（调用方应原样发送）。
 */
export function rewritePromptInBatchBody(
  bodyStr: string,
  originalText: string,
  augmentedText: string,
): string | null {
  if (!bodyStr || !originalText || augmentedText === originalText) return null;
  if (!bodyStr.includes('f.req=')) return null;

  const params = new URLSearchParams(bodyStr);
  const freq = params.get('f.req');
  if (!freq) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(freq);
  } catch {
    return null;
  }

  const trimmedOriginal = originalText.trim();
  const normalizedOriginal = normalizeWhitespace(originalText);
  const matches = (s: string): boolean =>
    s === originalText
    || s.trim() === trimmedOriginal
    // 最后一道：空白归一化后相等（NBSP / 折叠空格 / 零宽字符差异）
    || (normalizedOriginal.length > 0 && normalizeWhitespace(s) === normalizedOriginal);

  const { value, replaced } = replaceStringDeep(parsed, matches, augmentedText, originalText);
  if (!replaced) return null;

  params.set('f.req', JSON.stringify(value));
  return params.toString();
}
