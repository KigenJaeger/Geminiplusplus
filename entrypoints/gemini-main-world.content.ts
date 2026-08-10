// Gemini++ MAIN world content script
// 职责：在页面真实上下文里钩住 fetch / XMLHttpRequest，在发送消息的请求里
// 把用户 prompt 就地替换成【Gemini++ 系统规则】增强版——注入发生在网络层，输入框气泡保持干净。
//
// 命中方式：**不按 URL 白名单**。Gemini 发消息的端点会变（历史上是 batchexecute，
// 现在是 .../BardFrontendService/StreamGenerate），写死 URL 会导致钩子永不触发。
// 改为按请求体特征命中：POST + body 里含 `f.req=`，再由 codec 判断能否找到原文；
// 找不到就原样发送，绝不破坏请求。
//
// 数据来源：ISOLATED world 通过 window.postMessage 推来的快照（技能/记忆/预设/设置）与输入框文本；
// 反向回传：用了哪些记忆、当前消息计数、本轮激活的技能。
import { buildAugmentedPrompt } from '../core/prompt/augmentation';
import { isMemorySkill } from '../core/skill/memory';
import { rewritePromptInBatchBody } from '../core/gemini/batch-codec';
import { readBodySync, readBodyAsync, restoreBody, type NormalizedBody } from '../core/gemini/request-body';
import {
  BRIDGE_NAMESPACE,
  isBridgeMessage,
  postBridge,
  type BridgeSnapshot,
} from '../core/gemini/bridge';

const FETCH_HOOK_MARKER = Symbol.for('gemini-pp.fetch-hook-installed');
const XHR_HOOK_MARKER = Symbol.for('gemini-pp.xhr-hook-installed');

/** 诊断日志：默认开启，便于用户在 Gemini 页面 Console 里确认注入链路。 */
function debug(...args: unknown[]): void {
  console.log('[Gemini++/inject]', ...args);
}

export default defineContentScript({
  matches: ['https://gemini.google.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    let snapshot: BridgeSnapshot | null = null;
    let pendingText = '';
    let messageCount = 0;

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!isBridgeMessage(data)) return;
      if (data.kind === 'SNAPSHOT') {
        snapshot = data.snapshot;
      } else if (data.kind === 'PENDING_TEXT') {
        pendingText = data.text;
      }
    });

    /** body 是否值得尝试改写：含 f.req= 才是 Gemini 的 RPC 表单体。 */
    function isCandidateBody(text: string): boolean {
      return text.includes('f.req=');
    }

    // 计算增强后的请求体；找不到原文或无需增强时返回 null。
    function tryAugmentBody(bodyStr: string): string | null {
      if (!snapshot) {
        debug('跳过：尚未收到 ISOLATED 快照');
        return null;
      }
      if (!pendingText.trim()) {
        debug('跳过：pendingText 为空（没抓到输入框文本）');
        return null;
      }
      const original = pendingText;
      const result = buildAugmentedPrompt(original, {
        memories: snapshot.memories,
        skills: snapshot.skills,
        activePreset: snapshot.activePreset,
        activeProject: snapshot.activeProject,
        messageCount,
        memoryEnabled: snapshot.settings.memoryEnabled,
        presetEnabled: snapshot.settings.presetEnabled,
        presetCadence: snapshot.settings.presetCadence,
      });
      if (result.augmentedText === original) {
        debug('跳过：没有可注入内容', {
          输入: original.slice(0, 60),
          已启用技能: snapshot.skills.filter((s) => s.enabled).map((s) => s.name),
        });
        return null;
      }

      const rewritten = rewritePromptInBatchBody(bodyStr, original, result.augmentedText);
      if (rewritten === null) {
        debug('跳过：请求体里找不到用户原文', { 原文: original.slice(0, 60) });
        return null;
      }

      messageCount += 1;
      pendingText = '';
      debug('注入成功', { 技能: result.activatedSkill?.name ?? null, 消息数: messageCount });
      postBridge({ kind: 'ACTIVE_SKILL', name: result.activatedSkill?.name ?? null });
      postBridge({ kind: 'MSG_COUNT', count: messageCount });
      if (result.activatedSkill && isMemorySkill(result.activatedSkill) && result.visibleUserText.trim()) {
        postBridge({ kind: 'MEMORY_SAVE_REQUEST', skillName: result.activatedSkill.name, content: result.visibleUserText.trim() });
      }
      if (result.usedMemoryIds.length > 0) {
        postBridge({ kind: 'MEMORIES_USED', ids: result.usedMemoryIds });
      }
      return rewritten;
    }

    /** 归一化后的 body 走一遍改写，成功则返回同类型的新 body。 */
    function augmentNormalized(normalized: NormalizedBody | null): BodyInit | null {
      if (!normalized || !isCandidateBody(normalized.text)) return null;
      const rewritten = tryAugmentBody(normalized.text);
      if (rewritten === null) return null;
      return restoreBody(normalized, rewritten);
    }

    // ---- fetch 钩子 ----
    if (!(window as unknown as Record<symbol, unknown>)[FETCH_HOOK_MARKER]) {
      (window as unknown as Record<symbol, unknown>)[FETCH_HOOK_MARKER] = true;
      const originalFetch = window.fetch.bind(window);
      window.fetch = async function patchedFetch(
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> {
        try {
          const method = (
            init?.method ?? (input instanceof Request ? input.method : 'GET')
          ).toUpperCase();
          if (method === 'POST') {
            if (init?.body != null) {
              const newBody = augmentNormalized(await readBodyAsync(init.body));
              if (newBody !== null) {
                return originalFetch(input, { ...init, body: newBody });
              }
            } else if (input instanceof Request) {
              const bodyStr = await input.clone().text();
              const newBody = augmentNormalized({ text: bodyStr, kind: 'string' });
              if (newBody !== null) {
                return originalFetch(new Request(input, { body: newBody }));
              }
            }
          }
        } catch (error) {
          console.error('[Gemini++] fetch 注入失败，按原样发送', error);
        }
        return originalFetch(input, init);
      };
    }

    // ---- XHR 钩子（Gemini 若用 XHR 发送时兜底）----
    if (!(window as unknown as Record<symbol, unknown>)[XHR_HOOK_MARKER]) {
      (window as unknown as Record<symbol, unknown>)[XHR_HOOK_MARKER] = true;
      const proto = XMLHttpRequest.prototype;
      const originalOpen = proto.open;
      const originalSend = proto.send;
      proto.open = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
        (this as unknown as { __gemPPMethod?: string }).__gemPPMethod = method;
        // @ts-expect-error 透传其余参数
        return originalOpen.call(this, method, url, ...rest);
      };
      proto.send = function patchedSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
        try {
          const method = ((this as unknown as { __gemPPMethod?: string }).__gemPPMethod ?? 'GET').toUpperCase();
          if (method === 'POST' && body != null) {
            const newBody = augmentNormalized(readBodySync(body));
            if (newBody !== null) {
              return originalSend.call(this, newBody as XMLHttpRequestBodyInit);
            }
          }
        } catch (error) {
          console.error('[Gemini++] XHR 注入失败，按原样发送', error);
        }
        return originalSend.call(this, body ?? null);
      };
    }

    debug(`MAIN world hook ready (${BRIDGE_NAMESPACE})`);
  },
});
