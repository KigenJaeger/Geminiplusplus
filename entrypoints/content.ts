// Gemini++ content script（ISOLATED world）
// 职责：
// 1. 读取注入数据（技能/记忆/预设/设置），推给 MAIN world 网络钩子做发送前注入
// 2. 实时把输入框文本推给 MAIN world（供网络层按值替换 prompt）
// 3. / 技能快捷面板
// 4. 与 sidepanel / background 通信（GET_STATE / INJECT_PROMPT / 对话导出）
import { createGeminiComposer } from '../core/gemini/composer';
import { initSkillPopup } from '../core/ui/skill-popup';
import { postBridge, isBridgeMessage, type BridgeSnapshot } from '../core/gemini/bridge';
import { buildProjectSidebarModel, parseConversationId } from '../core/project/sidebar-model';
import { isPlaceholderTitle, normalizeConversationTitle } from '../core/project/title';
import { initProjectSidebar, refreshProjectSidebar } from '../core/ui/project-sidebar';
import { scrapeConversation } from '../core/gemini/conversation-export';
import type { GemMessage, GemStateSnapshot } from '../core/messaging/contract';
import type { NewSkill, Project, ProjectConversation } from '../core/types';
import { detectSkillDraft } from '../core/skill/draft-detect';

export default defineContentScript({
  matches: ['https://gemini.google.com/*'],
  runAt: 'document_idle',
  async main() {
    const composer = createGeminiComposer();

    // ---- SKILL.md 草稿识别 → “导入为 Skill” 按钮 ----
    // 识别逻辑在 core/skill/draft-detect.ts（纯函数、可测），这里只负责取文本和放按钮。
    // 之前漏判的四个原因：
    // 1. 门槛要求文本里出现 `---`，但代码块外的 `---` 会被 Gemini 渲染成 <hr>，
    //    innerText 里根本没有它。模型不把草稿包进代码块时必然漏判。
    // 2. 门槛还要求出现 skill 字样，技能本身不提这个词就被挡掉。
    // 3. 流式输出中途解析可能成功（frontmatter 齐了、正文还没写完），一旦成功就
    //    被 WeakSet 永久标记，按钮里存的是截断的正文。
    // 4. 卡片被 append 进 model-response 内部，它自己的文字会被下一轮当成技能正文读回去。
    interface DraftCardState {
      card: HTMLElement;
      signature: string;
    }
    const draftCards = new WeakMap<Element, DraftCardState>();
    /** 本页用过 /skill-creator，此时放宽识别：漏判代价远大于误判 */
    let skillCreatorUsed = false;

    /** 取回复正文。优先内层内容节点，避免把我们自己的卡片文字读进来。 */
    function responseText(node: Element): string {
      for (const selector of ['message-content', '.markdown', '.model-response-text']) {
        const inner = node.querySelector<HTMLElement>(selector);
        const text = inner?.innerText ?? '';
        if (text.trim()) return text;
      }
      return (node as HTMLElement).innerText || node.textContent || '';
    }

    function buildDraftCard(draft: NewSkill): HTMLElement {
      const card = document.createElement('div');
      card.style.cssText = 'margin:8px 0;padding:10px;border:1px solid #c7d2fe;border-radius:10px;background:#eef2ff;font:13px/1.4 system-ui;color:#1e1b4b;display:flex;align-items:center;gap:10px;';
      const label = document.createElement('span');
      label.textContent = `发现 Skill：/${draft.name}`;
      card.append(label);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '导入为 Skill';
      button.style.cssText = 'border:0;border-radius:7px;padding:5px 9px;background:#4f46e5;color:white;cursor:pointer;';
      button.addEventListener('click', (event) => {
        if (!event.isTrusted) return;
        button.disabled = true;
        button.textContent = '导入中…';
        chrome.runtime.sendMessage({ type: 'BG_SAVE_SKILL', ...draft }, (response) => {
          if (chrome.runtime.lastError || response?.ok === false) {
            button.disabled = false;
            button.textContent = '导入失败';
            return;
          }
          button.textContent = '已导入';
        });
      });
      card.append(button);
      return card;
    }

    function offerSkillImport(node: Element): void {
      const text = responseText(node);
      const existing = draftCards.get(node);
      // 文本没变且卡片还在页面上，就什么都不用做
      if (existing && existing.signature === text && existing.card.isConnected) return;

      const draft = detectSkillDraft(text, { trusted: skillCreatorUsed });
      if (!draft) {
        existing?.card.remove();
        draftCards.delete(node);
        return;
      }

      existing?.card.remove();
      const card = buildDraftCard(draft);
      // 放在 model-response 外面：放里面的话卡片文字会进 innerText，污染下一轮解析出的正文
      node.parentElement?.insertBefore(card, node.nextSibling);
      draftCards.set(node, { card, signature: text });
    }

    // 流式输出期间 mutation 极其密集，而 innerText 会触发同步排版。
    // 用 debounce 等输出停下来再扫，既省 CPU 又保证解析到的是完整正文。
    let draftScanTimer: ReturnType<typeof setTimeout> | undefined;
    function scheduleDraftScan(): void {
      clearTimeout(draftScanTimer);
      draftScanTimer = setTimeout(() => {
        document.querySelectorAll('model-response').forEach(offerSkillImport);
      }, 600);
    }
    const draftObserver = new MutationObserver(scheduleDraftScan);
    draftObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('beforeunload', () => {
      draftObserver.disconnect();
      clearTimeout(draftScanTimer);
    });
    let messageCount = 0; // 由 MAIN world 回传的实际计数
    let activeSkillName: string | null = null;

    interface InjectionData {
      skills: Array<{ name: string; description: string; instructions: string; enabled: boolean; memoryEnabled: boolean; memoryWriteEnabled?: boolean }>;
      memories: Array<{ id: number; name: string; description: string; content: string }>;
      activePreset: { id: string; name: string; content: string } | null;
      activeProject: { name: string; description: string; instructions: string } | null;
      settings: { memoryEnabled: boolean; presetEnabled: boolean; presetCadence: 'first_message' | 'every_message' | 'off' };
    }

    function fetchInjectionData(): Promise<InjectionData> {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'BG_GET_INJECTION_DATA' }, (response) => {
          if (chrome.runtime.lastError || !response) {
            reject(new Error(chrome.runtime.lastError?.message ?? 'no response'));
            return;
          }
          if ((response as { ok?: boolean }).ok === false) {
            reject(new Error((response as { error?: string }).error ?? 'BG_GET_INJECTION_DATA failed'));
            return;
          }
          resolve((response as { data: InjectionData }).data);
        });
      });
    }

    function touchMemoriesViaBackground(ids: number[]): void {
      if (ids.length === 0) return;
      void chrome.runtime.sendMessage({ type: 'BG_TOUCH_MEMORIES', ids });
    }

    function saveSkillMemory(skillName: string, content: string): void {
      const text = content.trim();
      if (!text) return;
      void chrome.runtime.sendMessage({ type: 'BG_MEMORY_SAVE', memory: {
        type: 'user', name: skillName, content: text,
        description: `由 /${skillName} 技能写入`, tags: [skillName, 'skill-memory'], pinned: true,
      }});
    }

    let boundConversationId = '';
    function bindPendingConversation(): void {
      const match = /^\/app\/([^/?#]+)/.exec(location.pathname);
      const conversationId = match?.[1] ?? '';
      if (!conversationId || conversationId === boundConversationId) return;
      boundConversationId = conversationId;
      chrome.runtime.sendMessage(
        { type: 'BG_BIND_PENDING_PROJECT', conversationId, title: normalizeConversationTitle(document.title), url: location.href },
        () => {
          // 绑定结果会改变母录的下属对话，立刻重画一次；lastError 读一下避免控制台噪音
          void chrome.runtime.lastError;
          void refreshProjectSidebar();
        },
      );
    }
    const projectConversationPoll = setInterval(bindPendingConversation, 1000);
    window.addEventListener('beforeunload', () => clearInterval(projectConversationPoll));

    // 绑定发生在对话刚拿到 id 的那一刻，那时 Gemini 还没给对话起名，document.title 只是站点名。
    // 等它命名后（通常是首轮回复结束）再上报一次，让母录里的子对话显示真实标题。
    let lastReportedKey = '';
    let pendingTitleKey = '';
    function syncConversationTitle(): void {
      const conversationId = parseConversationId(location.pathname);
      if (!conversationId) return;
      const title = normalizeConversationTitle(document.title);
      if (!title || isPlaceholderTitle(title)) return;
      // 这是个 SPA：切换对话时 URL 先变、document.title 还停在上一条对话上。
      // 直接上报会把旧标题写到新对话头上，所以要求同一组 (id, 标题) 连续两轮都一致，
      // 确认标题已经跟上了再写。
      const key = `${conversationId} ${title}`;
      if (key === lastReportedKey) return;
      if (key !== pendingTitleKey) {
        pendingTitleKey = key;
        return;
      }
      lastReportedKey = key;
      chrome.runtime.sendMessage(
        { type: 'BG_SYNC_CONVERSATION_TITLE', conversationId, title },
        (response) => {
          void chrome.runtime.lastError;
          // 只有真的改了才重画，避免无谓刷新
          if ((response as { conversation?: unknown } | undefined)?.conversation) void refreshProjectSidebar();
        },
      );
    }
    const titleSyncPoll = setInterval(syncConversationTitle, 2000);
    window.addEventListener('beforeunload', () => clearInterval(titleSyncPoll));

    // ---- 项目母录（注入 Gemini 原生左侧对话列表） ----
    function sendBg<T>(message: Record<string, unknown>): Promise<T> {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError || !response) {
            reject(new Error(chrome.runtime.lastError?.message ?? 'no response'));
            return;
          }
          if ((response as { ok?: boolean }).ok === false) {
            reject(new Error((response as { error?: string }).error ?? `${String(message.type)} failed`));
            return;
          }
          resolve(response as T);
        });
      });
    }

    /** 点 Gemini 自己的“发起新对话”，让它按自身逻辑开新会话；找不到按钮就退回导航。 */
    function clickNativeNewChat(): void {
      const selectors = [
        '[data-test-id="new-chat-button"]',
        'button[aria-label*="新对话"]',
        'button[aria-label*="新的对话"]',
        'button[aria-label*="New chat"]',
        'button[aria-label*="new chat"]',
      ];
      for (const selector of selectors) {
        const button = document.querySelector<HTMLElement>(selector);
        if (button) {
          button.click();
          return;
        }
      }
      location.assign('https://gemini.google.com/app');
    }

    initProjectSidebar({
      async load() {
        const data = await sendBg<{
          projects: Project[];
          conversations: ProjectConversation[];
          activeProjectId: string | null;
          pendingProjectId: string | null;
        }>({ type: 'BG_GET_PROJECTS' });
        return buildProjectSidebarModel({
          projects: data.projects,
          conversations: data.conversations,
          activeProjectId: data.activeProjectId,
          pendingProjectId: data.pendingProjectId,
          currentConversationId: parseConversationId(location.pathname),
        });
      },
      async startConversation(projectId) {
        // 先把项目设为激活（注入项目指令）并标记待接收，再让 Gemini 开新对话；
        // 已有的 URL 轮询会在新对话 id 出现时把它绑到这个项目下。
        await sendBg({ type: 'BG_SET_ACTIVE_PROJECT', id: projectId });
        await sendBg({ type: 'BG_SET_PENDING_PROJECT', id: projectId });
        await refreshSnapshot();
        clickNativeNewChat();
        void refreshProjectSidebar();
      },
      async renameConversation(conversationId, title) {
        await sendBg({ type: 'BG_RENAME_PROJECT_CONVERSATION', conversationId, title });
        void refreshProjectSidebar();
      },
      openProjectManager() {
        void chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
      },
    });

    // ---- 向 MAIN world 推送注入快照 ----
    let latestData: InjectionData | null = null;
    async function refreshSnapshot(): Promise<void> {
      try {
        const data = await fetchInjectionData();
        latestData = data;
        const snapshot: BridgeSnapshot = {
          skills: data.skills,
          memories: data.memories,
          activePreset: data.activePreset,
          activeProject: data.activeProject,
          settings: data.settings,
        };
        postBridge({ kind: 'SNAPSHOT', snapshot });
        initSkillPopup(data.skills.map((s) => ({ name: s.name, description: s.description, enabled: s.enabled })));
      } catch (error) {
        console.error('[Gemini++] 注入数据刷新失败', error);
      }
    }

    void refreshSnapshot();
    // 侧边栏改数据后无事件通知，采用可见时轮询 + 焦点/可见性刷新（都很轻）
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshSnapshot();
    }, 5000);
    window.addEventListener('focus', () => void refreshSnapshot());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refreshSnapshot();
    });
    window.addEventListener('beforeunload', () => clearInterval(poll));

    // ---- 实时推送输入框文本给 MAIN world ----
    let lastPushed = '';
    function pushPendingText(): void {
      const text = composer.getText();
      // Gemini clears the composer immediately after sending; retain the last
      // non-empty value until MAIN has rewritten the outgoing request.
      if (!text.trim()) return;
      if (text === lastPushed) return;
      lastPushed = text;
      activeSkillName = null;
      postBridge({ kind: 'PENDING_TEXT', text });
    }
    document.addEventListener('input', pushPendingText, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') pushPendingText();
    }, true);
    document.addEventListener('click', pushPendingText, true);
    const textPoll = setInterval(pushPendingText, 400);
    window.addEventListener('beforeunload', () => clearInterval(textPoll));

    // ---- 接收 MAIN world 回传 ----
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!isBridgeMessage(data)) return;
      if (data.kind === 'MEMORIES_USED') {
        touchMemoriesViaBackground(data.ids);
      } else if (data.kind === 'MEMORY_SAVE_REQUEST') {
        saveSkillMemory(data.skillName, data.content);
      } else if (data.kind === 'MSG_COUNT') {
        messageCount = data.count;
        lastPushed = '';
      } else if (data.kind === 'ACTIVE_SKILL') {
        activeSkillName = data.name;
        // 用过 skill-creator 就放宽草稿识别：这之后的回复本来就是来给技能的，
        // 漏判（没按钮）比误判（多一个按钮）难受得多
        if (data.name === 'skill-creator') skillCreatorUsed = true;
      }
    });

    // ---- 消息中继（sidepanel / background） ----
    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      const msg = message as GemMessage;
      if (msg?.type === 'GET_STATE') {
        void (async () => {
          try {
            const data = latestData ?? (await fetchInjectionData());
            const state: GemStateSnapshot = {
              skills: data.skills.map((s) => ({ name: s.name, description: s.description, enabled: s.enabled, source: 'custom' })),
              memories: [],
              activePreset: data.activePreset ? { id: data.activePreset.id, name: data.activePreset.name } : null,
              settings: {
                memoryEnabled: data.settings.memoryEnabled,
                presetEnabled: data.settings.presetEnabled,
                presetCadence: data.settings.presetCadence,
                skillInjectionEnabled: true,
              },
              messageCount,
              activeSkill: activeSkillName ? { name: activeSkillName } : null,
              hasGeminiPage: true,
            };
            sendResponse({ type: 'GET_STATE_RESPONSE', requestId: msg.requestId, state });
          } catch (error) {
            console.error('[Gemini++] GET_STATE failed', error);
            sendResponse({ type: 'GET_STATE_RESPONSE', requestId: msg.requestId, state: { skills: [], memories: [], activePreset: null, settings: { memoryEnabled: true, presetEnabled: true, presetCadence: 'first_message', skillInjectionEnabled: true }, messageCount, activeSkill: activeSkillName ? { name: activeSkillName } : null, hasGeminiPage: true } });
          }
        })();
        return true;
      }
      if (msg?.type === 'BG_REFRESH_INJECTION') {
        void refreshSnapshot();
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === 'INJECT_PROMPT') {
        composer.attach();
        if (!composer.isReady) {
          sendResponse({ type: 'INJECT_PROMPT_RESPONSE', requestId: msg.requestId, ok: false, error: 'Gemini 输入框尚未就绪' });
          return;
        }
        composer.setText(msg.text);
        sendResponse({ type: 'INJECT_PROMPT_RESPONSE', requestId: msg.requestId, ok: true });
        return;
      }
      if (msg?.type === 'EXPORT_CONVERSATION') {
        try {
          const conversation = scrapeConversation();
          sendResponse({ type: 'EXPORT_CONVERSATION_RESPONSE', requestId: msg.requestId, ok: true, conversation });
        } catch (error) {
          sendResponse({ type: 'EXPORT_CONVERSATION_RESPONSE', requestId: msg.requestId, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      return;
    });

    console.log('[Gemini++] content script ready (ISOLATED)');
  },
});
