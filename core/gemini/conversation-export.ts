// Gemini 对话导出：从页面 DOM 抓取当前会话的问答轮次，格式化为 Markdown。
//
// Gemini 网页无公开的会话读取接口，且 DeepSeek++ 的做法是走私有网络 API——对 Gemini 不可移植。
// 因此这里用 DOM 抓取：遍历 <user-query> / <model-response> 自定义元素（回退到常见 class），
// 提取纯文本。局限：富文本（代码块、表格）会被摊平为纯文本；Gemini 大改版后选择器可能需要更新。

export interface ExportTurn {
  role: 'user' | 'model';
  text: string;
}

export interface ExportedConversation {
  title: string;
  url: string;
  exportedAt: number;
  turns: ExportTurn[];
}

const USER_SELECTORS = [
  'user-query .query-text',
  'user-query .query-content',
  '.user-query-bubble-with-background',
  'user-query',
];

const MODEL_SELECTORS = [
  'model-response .markdown',
  'model-response message-content',
  'model-response .model-response-text',
  'model-response',
];

function firstText(root: ParentNode, selectors: string[]): string {
  for (const sel of selectors) {
    const el = root.querySelector<HTMLElement>(sel);
    const text = el?.innerText ?? el?.textContent ?? '';
    if (text.trim()) return text.trim();
  }
  if (root instanceof HTMLElement) {
    return (root.innerText ?? root.textContent ?? '').trim();
  }
  return '';
}

/** 抓取当前页面上的对话轮次，按出现顺序返回。 */
export function scrapeConversation(): ExportedConversation {
  const turns: ExportTurn[] = [];

  // 优先按 Gemini 的自定义元素抓取，保持问答顺序
  const nodes = document.querySelectorAll<HTMLElement>('user-query, model-response');
  if (nodes.length > 0) {
    nodes.forEach((node) => {
      const tag = node.tagName.toLowerCase();
      if (tag === 'user-query') {
        const text = firstText(node, USER_SELECTORS);
        if (text) turns.push({ role: 'user', text });
      } else {
        const text = firstText(node, MODEL_SELECTORS);
        if (text) turns.push({ role: 'model', text });
      }
    });
  }

  const title = (document.title || 'Gemini 对话').replace(/\s*[-–|]\s*Gemini\s*$/i, '').trim() || 'Gemini 对话';
  return {
    title,
    url: window.location.href,
    exportedAt: Date.now(),
    turns,
  };
}

/** 把抓取结果格式化为 Markdown 文本。 */
export function conversationToMarkdown(conv: ExportedConversation): string {
  const lines: string[] = [];
  lines.push(`# ${conv.title}`);
  lines.push('');
  lines.push(`> 导出自 ${conv.url}`);
  lines.push(`> 时间：${new Date(conv.exportedAt).toLocaleString()}`);
  lines.push('');

  if (conv.turns.length === 0) {
    lines.push('_未在当前页面找到可导出的对话内容。请确认已打开一个具体会话。_');
    return lines.join('\n');
  }

  for (const turn of conv.turns) {
    lines.push(turn.role === 'user' ? '## 🧑 用户' : '## ✨ Gemini');
    lines.push('');
    lines.push(turn.text);
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

/** 生成安全的导出文件名（不含扩展名）。 */
export function exportFilename(conv: ExportedConversation): string {
  const safeTitle = conv.title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'gemini-对话';
  const d = new Date(conv.exportedAt);
  const stamp =
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` +
    `-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `${safeTitle}-${stamp}`;
}
