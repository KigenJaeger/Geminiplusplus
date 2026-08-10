// Gemini++ 项目母录：注入 Gemini 原生左侧对话列表，在"最近"上方插入"项目"分组
//
// 形态对齐 DeepSeek++：项目是母录，点开露出它下属的对话，右侧 ＋ 直接在该项目下开新对话。
//
// 两个现实约束决定了实现方式：
// 1. Gemini 侧栏是 Angular 渲染的，随时可能整段重建 → 用 MutationObserver + 轮询兜底重新插入，
//    并且每次都按"我们的节点是否还在文档里"判断，而不是记住一次 DOM 引用。
// 2. Gemini 的类名是混淆的、会随版本变 → 锚点用多级降级策略定位，全都失败就安静放弃，
//    绝不抛错、绝不动 Gemini 自己的节点。

import type { ProjectSidebarConversation, ProjectSidebarNode } from '../project/sidebar-model';

const CONTAINER_ID = 'gem-pp-project-sidebar';
const STYLE_ID = 'gem-pp-project-sidebar-css';

export interface ProjectSidebarHost {
  /** 读取最新的项目树 */
  load: () => Promise<ProjectSidebarNode[]>;
  /** 在指定项目下开一个新对话 */
  startConversation: (projectId: string) => Promise<void>;
  /** 给下属对话改名（会锁定，不再被 Gemini 的标题覆盖） */
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  /** 打开侧边栏的项目页（用于新建项目） */
  openProjectManager: () => void;
}

let host: ProjectSidebarHost | null = null;
let nodes: ProjectSidebarNode[] = [];
/** 用户手动展开/收起的项目；未记录过的项目走"包含当前对话则展开"的默认 */
const expandOverrides = new Map<string, boolean>();
let started = false;
let refreshing = false;
/** 上一次真正渲染出来的内容指纹；只有它变了才重绘，否则 mutation 会和重绘互相触发死循环 */
let lastSignature = '';
/** 上一次插入位置的锚点，命中就不用再全文档找一遍 */
let lastAnchor: HTMLElement | null = null;
let mountScheduled = false;
/** ensureMounted 重入锁 */
let mounting = false;
/** 上一次做全文档锚点搜索的时间，用来限流 */
let lastAnchorSearchAt = 0;
/** 正在改名的子对话 id；非空时输入框在编辑中，任何自动重绘都要让路，否则会把用户打字打断 */
let editingConversationId = '';
/** 编辑中已经输入的内容。Angular 重建侧栏会连带我们的容器一起重插，
 *  输入框随之重建；不记住草稿的话用户打的字会被还原成旧标题。 */
let editingDraft = '';

export function initProjectSidebar(injectedHost: ProjectSidebarHost): void {
  host = injectedHost;
  if (started) {
    void refreshProjectSidebar();
    return;
  }
  started = true;
  injectStyles();

  // Angular 重建侧栏后我们的节点会被一起丢掉，靠观察 + 轮询重新插入。
  // 关键：忽略我们自己容器内部的变动，并且合并到下一帧执行，否则「渲染→mutation→再渲染」会锁死主线程。
  const observer = new MutationObserver((records) => {
    if (!records.some(isForeignMutation)) return;
    scheduleMount();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const poll = setInterval(() => void refreshProjectSidebar(), 5000);
  window.addEventListener('beforeunload', () => {
    observer.disconnect();
    clearInterval(poll);
  });

  void refreshProjectSidebar();
}

/** 重新拉取数据并重绘。 */
export async function refreshProjectSidebar(): Promise<void> {
  if (!host || refreshing) return;
  // 用户正在输入新名字，这时候拉数据重绘会把输入框连同内容一起换掉
  if (editingConversationId) return;
  refreshing = true;
  try {
    nodes = await host.load();
    ensureMounted();
  } catch {
    /* 读取失败就保留上一次的渲染，不打断用户 */
  } finally {
    refreshing = false;
  }
}

/** 变动是否来自 Gemini 自己（不在我们容器内），只有这种才值得重新挂载。 */
function isForeignMutation(record: MutationRecord): boolean {
  const target = record.target as Node | null;
  if (!target) return false;
  const element = target.nodeType === Node.ELEMENT_NODE ? (target as HTMLElement) : target.parentElement;
  if (!element) return false;
  if (element.id === CONTAINER_ID || element.closest(`#${CONTAINER_ID}`)) return false;
  return true;
}

/** 把挂载合并到下一帧，避免一批 mutation 触发多次全文档查询。 */
function scheduleMount(): void {
  if (mountScheduled) return;
  mountScheduled = true;
  requestAnimationFrame(() => {
    mountScheduled = false;
    ensureMounted();
  });
}

/** 找到"最近/Recent"对话列表的容器，我们插在它前面。 */
function findAnchor(): HTMLElement | null {
  // 0) 上次的锚点还在文档里就直接复用，省掉整篇文档的查询
  if (lastAnchor?.isConnected) return lastAnchor;

  // 找不到锚点时不要每帧都全文档扫一遍：Angular 一直在动，会持续吃 CPU
  const now = Date.now();
  if (now - lastAnchorSearchAt < 500) return null;
  lastAnchorSearchAt = now;

  // 1) 语义化标签优先：Gemini 用自定义元素承载历史列表
  const semantic = document.querySelector<HTMLElement>(
    'conversations-list, .conversations-container, [data-test-id="conversations-list"]',
  );
  if (semantic?.isConnected) return semantic;

  // 2) 从对话项反推它们的共同父节点
  const items = document.querySelectorAll<HTMLElement>(
    '[data-test-id="conversation"], .conversation-items-container, .conversation',
  );
  if (items.length > 0) {
    const parent = items[0]!.parentElement;
    if (parent?.isConnected) return parent;
  }

  // 3) 按标题文字找"最近"分组，插在标题前
  const headings = document.querySelectorAll<HTMLElement>('h1, h2, h3, span, div');
  for (const heading of headings) {
    const text = (heading.textContent ?? '').trim();
    if (text !== '最近' && text !== 'Recent' && text !== '近期') continue;
    // 只认短文本节点，避免匹配到包含整个侧栏的大容器
    if (text.length > 6 || heading.childElementCount > 0) continue;
    const wrapper = heading.closest<HTMLElement>('div');
    if (wrapper?.isConnected) return wrapper;
  }

  return null;
}

/** 侧栏收起时不渲染，避免在窄条里挤出错位的内容。 */
function isSidebarCollapsed(anchor: HTMLElement): boolean {
  const nav = anchor.closest<HTMLElement>('nav, [role="navigation"], bard-sidenav, .sidenav') ?? anchor;
  return nav.getBoundingClientRect().width < 120;
}

/** 当前模型 + 展开状态的指纹；一致就说明没必要重绘。 */
function computeSignature(): string {
  return `edit:${editingConversationId}\n` + nodes
    .map((node) => {
      const flags = `${isExpanded(node) ? 'e' : 'c'}${node.isPending ? 'p' : ''}${node.containsCurrent ? 'x' : ''}`;
      const children = node.conversations
        .map((conversation) => `${conversation.conversationId}${conversation.isCurrent ? '*' : ''}:${conversation.title}`)
        .join('|');
      return `${node.id}~${node.name}~${flags}~${children}`;
    })
    .join('\n');
}

function unmount(existing: HTMLElement | null): void {
  existing?.remove();
  lastSignature = '';
  // 容器被摘掉时输入框也没了，blur 不会触发。这里必须清掉编辑态，
  // 否则 refreshProjectSidebar 会被永久挡住，母录再也不更新。
  editingConversationId = '';
  editingDraft = '';
}

function ensureMounted(): void {
  // 重绘会摘掉旧节点，可能触发输入框 blur，blur 处理里又会调回这里。
  // 不加锁的话会在半完成的 DOM 上递归。
  if (mounting) return;
  mounting = true;
  try {
    mountOnce();
  } finally {
    mounting = false;
  }
}

function mountOnce(): void {
  const existing = document.getElementById(CONTAINER_ID);
  if (nodes.length === 0) {
    // 没有项目就不占位置
    unmount(existing);
    return;
  }

  const anchor = findAnchor();
  if (!anchor) {
    unmount(existing);
    return;
  }
  lastAnchor = anchor;
  if (isSidebarCollapsed(anchor)) {
    unmount(existing);
    return;
  }

  // 已在正确位置：内容没变就什么都不做。这一条是防死循环的关键——
  // 无条件 render 会产生新的 mutation，mutation 又触发 ensureMounted，主线程会被锁住。
  if (existing?.isConnected && existing.nextElementSibling === anchor) {
    const signature = computeSignature();
    if (signature === lastSignature) return;
    render(existing);
    lastSignature = signature;
    return;
  }

  existing?.remove();
  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  render(container);
  anchor.parentElement?.insertBefore(container, anchor);
  lastSignature = computeSignature();
}

function isExpanded(node: ProjectSidebarNode): boolean {
  return expandOverrides.get(node.id) ?? node.containsCurrent;
}

/** 进入/退出改名编辑态。 */
function setEditing(conversationId: string, draft = ''): void {
  editingConversationId = conversationId;
  editingDraft = draft;
  ensureMounted();
}

/** 一条子对话：链接 + 悬停出现的改名按钮。 */
function buildChildRow(conversation: ProjectSidebarConversation): HTMLElement {
  const row = document.createElement('div');
  row.className = 'gem-pp-proj-child-row';

  const link = document.createElement('a');
  link.className = 'gem-pp-proj-child';
  if (conversation.isCurrent) link.classList.add('gem-pp-proj-child-current');
  link.href = conversation.url || `https://gemini.google.com/app/${conversation.conversationId}`;
  link.textContent = conversation.title;
  link.title = `${conversation.title}\n双击可改名`;
  // 双击改名，和 Gemini 自己的重命名交互一致
  link.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setEditing(conversation.conversationId);
  });
  row.append(link);

  const rename = document.createElement('button');
  rename.type = 'button';
  rename.className = 'gem-pp-proj-icon-btn gem-pp-proj-rename';
  rename.title = '重命名';
  rename.setAttribute('aria-label', `重命名 ${conversation.title}`);
  rename.textContent = '✎';
  rename.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setEditing(conversation.conversationId);
  });
  row.append(rename);

  return row;
}

/** 改名输入框：回车保存，Esc / 失焦取消。 */
function buildEditor(conversationId: string, currentTitle: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'gem-pp-proj-child-row';

  const input = document.createElement('input');
  input.className = 'gem-pp-proj-edit';
  input.type = 'text';
  // 用草稿而不是 currentTitle：容器被 Angular 连带重建时输入框会重新造一个，
  // 读草稿才能把用户已经打的字接回来
  input.value = editingDraft || currentTitle;
  input.maxLength = 200;
  input.setAttribute('aria-label', '对话名称');
  input.addEventListener('input', () => {
    editingDraft = input.value;
  });

  let settled = false;
  const cancel = (): void => {
    if (settled) return;
    settled = true;
    setEditing('');
  };
  const commit = (): void => {
    if (settled) return;
    const name = input.value.trim();
    if (!name || name === currentTitle) {
      cancel();
      return;
    }
    settled = true;
    editingConversationId = '';
    editingDraft = '';
    void host?.renameConversation(conversationId, name).catch(() => {
      // 失败就重画回原样，用户能看到名字没变
      void refreshProjectSidebar();
    });
    ensureMounted();
  };

  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  });
  input.addEventListener('blur', () => {
    // 节点被摘掉（侧栏重建）也会走到这里，那不是用户点开了别处，不能当取消处理，
    // 否则重建一次就把编辑态清了，而且会在 ensureMounted 内部递归调用它自己
    if (!input.isConnected) return;
    cancel();
  });
  // 插入 DOM 之后才能聚焦，所以推到下一帧
  requestAnimationFrame(() => {
    if (!input.isConnected) return;
    input.focus();
    input.select();
  });

  wrapper.append(input);
  return wrapper;
}

function render(container: HTMLElement): void {
  container.replaceChildren();

  const header = document.createElement('div');
  header.className = 'gem-pp-proj-header';
  const title = document.createElement('span');
  title.className = 'gem-pp-proj-header-title';
  title.textContent = '项目';
  header.append(title);
  const manage = document.createElement('button');
  manage.type = 'button';
  manage.className = 'gem-pp-proj-icon-btn';
  manage.title = '管理项目';
  manage.setAttribute('aria-label', '管理项目');
  manage.textContent = '⋯';
  manage.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    host?.openProjectManager();
  });
  header.append(manage);
  container.append(header);

  for (const node of nodes) {
    const expanded = isExpanded(node);

    const row = document.createElement('div');
    row.className = 'gem-pp-proj-row';
    if (node.containsCurrent) row.classList.add('gem-pp-proj-row-current');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'gem-pp-proj-toggle';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.title = node.description || node.name;

    const caret = document.createElement('span');
    caret.className = 'gem-pp-proj-caret';
    caret.textContent = expanded ? '▾' : '▸';
    toggle.append(caret);

    const folder = document.createElement('span');
    folder.className = 'gem-pp-proj-folder';
    folder.textContent = '🗀';
    toggle.append(folder);

    const name = document.createElement('span');
    name.className = 'gem-pp-proj-name';
    name.textContent = node.name;
    toggle.append(name);

    if (node.conversations.length > 0) {
      const count = document.createElement('span');
      count.className = 'gem-pp-proj-count';
      count.textContent = String(node.conversations.length);
      toggle.append(count);
    }
    if (node.isPending) {
      const badge = document.createElement('span');
      badge.className = 'gem-pp-proj-badge';
      badge.textContent = '待接收';
      badge.title = '下一次新对话会归入这个项目';
      toggle.append(badge);
    }

    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      expandOverrides.set(node.id, !expanded);
      ensureMounted();
    });
    row.append(toggle);

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'gem-pp-proj-icon-btn';
    add.title = `在「${node.name}」下开新对话`;
    add.setAttribute('aria-label', `在 ${node.name} 下开新对话`);
    add.textContent = '＋';
    add.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      add.disabled = true;
      void host?.startConversation(node.id).finally(() => {
        add.disabled = false;
      });
    });
    row.append(add);
    container.append(row);

    if (!expanded) continue;

    const list = document.createElement('div');
    list.className = 'gem-pp-proj-children';
    if (node.conversations.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'gem-pp-proj-empty';
      empty.textContent = node.isPending ? '等待下一次新对话' : '还没有对话';
      list.append(empty);
    } else {
      for (const conversation of node.conversations) {
        list.append(
          conversation.conversationId === editingConversationId
            ? buildEditor(conversation.conversationId, conversation.title)
            : buildChildRow(conversation),
        );
      }
    }
    container.append(list);
  }
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // 颜色全部用 currentColor / 半透明叠加，跟随 Gemini 自身的明暗主题，不写死配色
  style.textContent = `
#${CONTAINER_ID} {
  margin: 4px 0 8px;
  padding: 0 8px;
  font: 13px/1.4 'Google Sans', Roboto, system-ui, sans-serif;
  color: inherit;
}
#${CONTAINER_ID} .gem-pp-proj-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 8px 2px; font-size: 11px; letter-spacing: .04em;
  opacity: .6; text-transform: none;
}
#${CONTAINER_ID} .gem-pp-proj-header-title { font-weight: 600; }
#${CONTAINER_ID} .gem-pp-proj-row {
  display: flex; align-items: center; gap: 2px;
  border-radius: 999px; padding-right: 4px;
}
#${CONTAINER_ID} .gem-pp-proj-row:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
#${CONTAINER_ID} .gem-pp-proj-row-current { background: color-mix(in srgb, currentColor 14%, transparent); }
#${CONTAINER_ID} .gem-pp-proj-toggle {
  flex: 1 1 auto; min-width: 0;
  display: flex; align-items: center; gap: 6px;
  background: none; border: 0; cursor: pointer;
  padding: 7px 4px 7px 8px; border-radius: 999px;
  color: inherit; font: inherit; text-align: left;
}
#${CONTAINER_ID} .gem-pp-proj-caret { flex: 0 0 auto; font-size: 9px; opacity: .7; width: 9px; }
#${CONTAINER_ID} .gem-pp-proj-folder { flex: 0 0 auto; font-size: 13px; opacity: .85; }
#${CONTAINER_ID} .gem-pp-proj-name {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#${CONTAINER_ID} .gem-pp-proj-count { flex: 0 0 auto; font-size: 11px; opacity: .55; }
#${CONTAINER_ID} .gem-pp-proj-badge {
  flex: 0 0 auto; font-size: 10px; padding: 1px 6px; border-radius: 999px;
  background: color-mix(in srgb, currentColor 16%, transparent); opacity: .8;
}
#${CONTAINER_ID} .gem-pp-proj-icon-btn {
  flex: 0 0 auto; width: 24px; height: 24px; line-height: 1;
  display: grid; place-items: center;
  background: none; border: 0; border-radius: 50%; cursor: pointer;
  color: inherit; opacity: .55; font-size: 13px;
}
#${CONTAINER_ID} .gem-pp-proj-icon-btn:hover { opacity: 1; background: color-mix(in srgb, currentColor 16%, transparent); }
#${CONTAINER_ID} .gem-pp-proj-icon-btn:disabled { opacity: .3; cursor: default; }
#${CONTAINER_ID} .gem-pp-proj-children { margin: 0 0 4px; padding-left: 23px; }
#${CONTAINER_ID} .gem-pp-proj-child-row {
  display: flex; align-items: center; gap: 2px; border-radius: 8px;
}
#${CONTAINER_ID} .gem-pp-proj-child {
  flex: 1 1 auto; min-width: 0;
  display: block; padding: 5px 8px; border-radius: 8px;
  color: inherit; text-decoration: none; opacity: .8;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* 改名按钮平时藏起来，悬停或键盘聚焦时才出现，别抢子对话的空间 */
#${CONTAINER_ID} .gem-pp-proj-rename { width: 20px; height: 20px; font-size: 11px; opacity: 0; }
#${CONTAINER_ID} .gem-pp-proj-child-row:hover .gem-pp-proj-rename { opacity: .55; }
#${CONTAINER_ID} .gem-pp-proj-rename:hover,
#${CONTAINER_ID} .gem-pp-proj-rename:focus-visible { opacity: 1; }
#${CONTAINER_ID} .gem-pp-proj-edit {
  flex: 1 1 auto; min-width: 0;
  padding: 4px 7px; border-radius: 8px;
  color: inherit; font: inherit;
  background: color-mix(in srgb, currentColor 8%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  outline: none;
}
#${CONTAINER_ID} .gem-pp-proj-child:hover { background: color-mix(in srgb, currentColor 10%, transparent); opacity: 1; }
#${CONTAINER_ID} .gem-pp-proj-child-current { background: color-mix(in srgb, currentColor 14%, transparent); opacity: 1; font-weight: 500; }
#${CONTAINER_ID} .gem-pp-proj-empty { padding: 5px 8px; font-size: 12px; opacity: .45; }
`;
  document.head.append(style);
}
