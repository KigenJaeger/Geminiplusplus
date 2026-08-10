// Gemini 页面集成层：定位输入框、读写文本、触发发送
// 适配 gemini.google.com DOM：初始 SSR 是 .initial-input-area textarea，
// 应用启动后是 contenteditable 的 rich-textarea（富文本编辑器）
export interface GeminiComposer {
  attach(): void;
  setText(text: string): void;
  getText(): string;
  clear(): void;
  send(): boolean;
  readonly isReady: boolean;
}

export function createGeminiComposer(): GeminiComposer {
  function findInput(): HTMLElement | null {
    // 方案 A：textarea（初始 SSR 或降级）
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '.initial-input-area textarea, rich-textarea textarea, textarea[placeholder]',
    );
    if (textarea && isVisible(textarea)) return textarea;

    // 方案 B：contenteditable（应用启动后的主输入区）
    return findEditable();
  }

  function findEditable(): HTMLElement | null {
    const candidates = document.querySelectorAll<HTMLElement>(
      'rich-textarea .ql-editor[contenteditable="true"], .ql-editor[contenteditable="true"], rich-textarea[contenteditable="true"]',
    );
    for (const el of candidates) {
      if (isVisible(el)) return el;
    }
    return null;
  }

  function isVisible(el: HTMLElement): boolean {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
  }

  function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return {
    attach() {
      // no-op：每次操作都实时查询
    },
    get isReady() {
      return findInput() !== null;
    },
    getText() {
      const el = findInput();
      if (!el) return '';
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
      return (el.textContent ?? '').replace(/\u200b/g, '');
    },
    setText(text: string) {
      const el = findInput();
      if (!el) return;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        setNativeValue(el, text);
        return;
      }
      // contenteditable：用 execCommand('insertText')，富文本编辑器原生响应
      el.focus();
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    clear() {
      const el = findInput();
      if (!el) return;
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        setNativeValue(el, '');
        return;
      }
      el.focus();
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('delete');
    },
    send() {
      const sendButton = document.querySelector<HTMLElement>(
        'button[aria-label*="发送"], button[aria-label*="Send"], button.send-button, .send-button',
      );
      if (sendButton && isVisible(sendButton)) {
        sendButton.click();
        return true;
      }
      const el = findInput();
      if (el) {
        el.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true,
        }));
        return true;
      }
      return false;
    },
  };
}
