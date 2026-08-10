// 对话标题的清洗与占位判定。
//
// 绑定发生在新对话刚出现 id 的那一刻，那时 Gemini 还没给对话起名，document.title 只是
// 站点名（"Google Gemini"）。所以标题要分两步：先落一个占位，之后等 Gemini 命名了再同步。
// 判定逻辑放在这里，纯函数、无 DOM 无 chrome，可以在 node 环境下测。

/** 兜底标题，落库时占位用 */
export const FALLBACK_CONVERSATION_TITLE = 'Gemini 对话';

/** document.title 里这些值说明 Gemini 还没给对话命名 */
const PLACEHOLDER_TITLES = new Set([
  '',
  'gemini',
  'google gemini',
  'bard',
  'google bard',
  FALLBACK_CONVERSATION_TITLE.toLowerCase(),
]);

/** 去掉 document.title 的站点后缀，例如 "写个脚本 - Google Gemini" → "写个脚本" */
export function normalizeConversationTitle(raw: string): string {
  return raw
    .replace(/\s*[-–—|]\s*(Google\s+)?(Gemini|Bard).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * 用户手动输入的名字只做无损清洗：压空白 + 限长。
 * 绝不能走 normalizeConversationTitle——那个会剥站点后缀，
 * 用户想叫「调试 - Gemini 注入问题」会被截成「调试」。
 */
export function sanitizeManualTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** 这个标题是否还只是占位（没有真实对话名） */
export function isPlaceholderTitle(title: string): boolean {
  return PLACEHOLDER_TITLES.has(title.trim().toLowerCase());
}

/**
 * 判断是否应该把页面标题同步进存储。
 * 只在「用户没手动改过」且「新标题是真名」且「和旧的不一样」时同步；
 * 旧标题已经是真名时也允许更新，因为 Gemini 自己会改名。
 */
export function shouldSyncTitle(input: {
  storedTitle: string;
  incomingTitle: string;
  titleLocked?: boolean;
}): boolean {
  if (input.titleLocked) return false;
  const incoming = normalizeConversationTitle(input.incomingTitle);
  if (!incoming || isPlaceholderTitle(incoming)) return false;
  return incoming !== input.storedTitle.trim();
}
