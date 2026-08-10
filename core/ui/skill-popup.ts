// Gemini++ 技能快捷面板：在 Gemini 输入框输入 / 时弹出技能列表
export interface SkillPopupItem {
  name: string;
  description: string;
  enabled: boolean;
}

let popupEl: HTMLElement | null = null;
let skills: SkillPopupItem[] = [];
let filtered: SkillPopupItem[] = [];
let activeIdx = 0;
let textareaEl: HTMLElement | null = null;
let attached = false;

export function initSkillPopup(initialSkills: SkillPopupItem[]): void {
  skills = initialSkills.filter((s) => s.enabled);
  if (attached) return;
  attached = true;
  injectStyles();
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mousedown', onClickOutside);
  const probe = () => {
    const el = document.querySelector<HTMLElement>(
      'rich-textarea .ql-editor, .ql-editor[contenteditable="true"], .initial-input-area textarea',
    );
    if (el && el !== textareaEl) {
      if (textareaEl) textareaEl.removeEventListener('input', onInput);
      textareaEl = el;
      el.addEventListener('input', onInput);
    }
  };
  probe();
  const poll = setInterval(probe, 1200);
  window.addEventListener('beforeunload', () => clearInterval(poll));
}

export function stopSkillPopup(): void {
  attached = false;
  if (textareaEl) textareaEl.removeEventListener('input', onInput);
  textareaEl = null;
  document.removeEventListener('keydown', onKeydown, true);
  document.removeEventListener('mousedown', onClickOutside);
  popupEl?.remove();
  popupEl = null;
  document.getElementById('gem-pp-skill-popup-css')?.remove();
}

export function updateSkills(next: SkillPopupItem[]): void {
  skills = next.filter((s) => s.enabled);
  if (isVisible()) rebuild();
}

function currentText(): string {
  if (!textareaEl) return '';
  if (textareaEl instanceof HTMLTextAreaElement || textareaEl instanceof HTMLInputElement) return textareaEl.value;
  return (textareaEl.textContent ?? '').replace(/\u200b/g, '');
}

function onInput(): void {
  const val = currentText();
  if (val.startsWith('/') && !val.slice(1).includes(' ')) {
    const query = val.slice(1).toLowerCase();
    filtered = query === ''
      ? [...skills]
      : skills.filter((s) => s.name.toLowerCase().startsWith(query));
    if (filtered.length > 0) {
      activeIdx = 0;
      showPopup();
      return;
    }
  }
  hidePopup();
}

function onKeydown(e: KeyboardEvent): void {
  if (!isVisible()) return;
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      e.stopImmediatePropagation();
      activeIdx = (activeIdx + 1) % filtered.length;
      highlight();
      break;
    case 'ArrowUp':
      e.preventDefault();
      e.stopImmediatePropagation();
      activeIdx = (activeIdx - 1 + filtered.length) % filtered.length;
      highlight();
      break;
    case 'Tab':
    case 'Enter':
      e.preventDefault();
      e.stopImmediatePropagation();
      select(filtered[activeIdx]);
      break;
    case 'Escape':
      e.preventDefault();
      e.stopImmediatePropagation();
      hidePopup();
      break;
  }
}

function onClickOutside(e: MouseEvent): void {
  if (!isVisible()) return;
  if (popupEl?.contains(e.target as Node)) return;
  hidePopup();
}

function select(skill: SkillPopupItem | undefined): void {
  if (!skill || !textareaEl) return;
  const newVal = `/${skill.name} `;
  if (textareaEl instanceof HTMLTextAreaElement || textareaEl instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(textareaEl.constructor.prototype, 'value')?.set;
    if (setter) setter.call(textareaEl, newVal);
    else textareaEl.value = newVal;
    textareaEl.dispatchEvent(new Event('input', { bubbles: true }));
    textareaEl.focus();
    textareaEl.setSelectionRange(newVal.length, newVal.length);
  } else {
    textareaEl.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(textareaEl);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand('insertText', false, newVal);
  }
  hidePopup();
}

function showPopup(): void {
  if (!textareaEl) return;
  if (!popupEl) {
    popupEl = document.createElement('div');
    popupEl.className = 'gem-pp-skill-popup';
    document.body.appendChild(popupEl);
  }
  const rect = textareaEl.getBoundingClientRect();
  Object.assign(popupEl.style, {
    display: 'block',
    left: `${Math.max(8, rect.left)}px`,
    bottom: `${window.innerHeight - rect.top + 6}px`,
    width: `${Math.min(rect.width * 0.6, 300)}px`,
  });
  rebuild();
}

function rebuild(): void {
  if (!popupEl) return;
  popupEl.innerHTML = filtered.map((s, i) => `
    <div class="gem-pp-skill-item${i === activeIdx ? ' gem-pp-active' : ''}" data-i="${i}">
      <div class="gem-pp-skill-head"><code class="gem-pp-trigger">/${escapeHtml(s.name)}</code></div>
      <div class="gem-pp-skill-desc">${escapeHtml(s.description)}</div>
    </div>
  `).join('') + '<div class="gem-pp-skill-hint">↑↓ 导航 · Enter 选择 · Esc 关闭</div>';

  popupEl.querySelectorAll('.gem-pp-skill-item').forEach((el) => {
    const i = parseInt((el as HTMLElement).dataset.i || '0', 10);
    el.addEventListener('mouseenter', () => { activeIdx = i; highlight(); });
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      select(filtered[i]);
    });
  });
}

function highlight(): void {
  if (!popupEl) return;
  popupEl.querySelectorAll('.gem-pp-skill-item').forEach((el, i) => {
    el.classList.toggle('gem-pp-active', i === activeIdx);
  });
}

function hidePopup(): void {
  if (popupEl) popupEl.style.display = 'none';
}

function isVisible(): boolean {
  return popupEl !== null && popupEl.style.display !== 'none';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function injectStyles(): void {
  if (document.getElementById('gem-pp-skill-popup-css')) return;
  const style = document.createElement('style');
  style.id = 'gem-pp-skill-popup-css';
  style.textContent = `
.gem-pp-skill-popup {
  position: fixed;
  z-index: 2147483647;
  background: #fff;
  border: 1px solid #e2e5ed;
  border-radius: 12px;
  padding: 4px;
  box-shadow: 0 8px 30px rgba(0,0,0,.15);
  display: none;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif;
  max-height: 240px;
  overflow-y: auto;
}
@media (prefers-color-scheme: dark) {
  .gem-pp-skill-popup { background: #242731; border-color: #333847; }
}
.gem-pp-skill-item { padding: 8px 12px; border-radius: 8px; cursor: pointer; }
.gem-pp-skill-item.gem-pp-active { background: #eef1fe; }
@media (prefers-color-scheme: dark) {
  .gem-pp-skill-item.gem-pp-active { background: #2a3050; }
}
.gem-pp-skill-head { display: flex; align-items: center; }
.gem-pp-trigger {
  color: #4f6bf0;
  font-size: 13px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-weight: 600;
  background: #eef1fe;
  padding: 1px 6px;
  border-radius: 4px;
}
@media (prefers-color-scheme: dark) {
  .gem-pp-trigger { color: #7c93ff; background: #2a3050; }
}
.gem-pp-skill-desc { color: #6b7280; font-size: 11px; margin-top: 2px; }
@media (prefers-color-scheme: dark) {
  .gem-pp-skill-desc { color: #9aa1b2; }
}
.gem-pp-skill-hint { text-align: center; color: #9aa1b2; font-size: 10px; padding: 4px 0 2px; border-top: 1px solid #e2e5ed; margin-top: 4px; }
`;
  document.head.appendChild(style);
}
