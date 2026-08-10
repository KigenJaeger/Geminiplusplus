// ISOLATED ↔ MAIN world 桥接协议（同一页面，用 window.postMessage 通信）
//
// 背景：Gemini 网页版走 gRPC-Web / batchexecute 流，注入必须在网络层改写请求体，
// 而网络钩子（fetch/XHR）只能安装在 MAIN world（页面真实上下文）。但 MAIN world
// 拿不到 chrome.runtime，读不到扩展存储；ISOLATED world 能访问 chrome.runtime 却
// 钩不到页面的 fetch。于是：
//   - ISOLATED：读取注入数据（技能/记忆/预设/设置）与输入框文本，推给 MAIN
//   - MAIN：持有快照，在发送请求时把 prompt 就地替换为增强版，再回传"用了哪些记忆/消息数"
// 两端都监听同一 window 的 message，用 kind 区分方向，不会形成回环。

export const BRIDGE_NAMESPACE = 'gemini-pp-bridge-v1';

export interface BridgeSnapshot {
  skills: Array<{
    name: string;
    description: string;
    instructions: string;
    enabled: boolean;
    memoryEnabled: boolean;
    memoryWriteEnabled?: boolean;
  }>;
  memories: Array<{ id: number; name: string; description: string; content: string }>;
  activePreset: { id: string; name: string; content: string } | null;
  activeProject: { name: string; description: string; instructions: string } | null;
  settings: {
    memoryEnabled: boolean;
    presetEnabled: boolean;
    presetCadence: 'first_message' | 'every_message' | 'off';
    skillInjectionEnabled: boolean;
  };
}

export type BridgeMessage =
  // ISOLATED → MAIN
  | { ns: typeof BRIDGE_NAMESPACE; kind: 'SNAPSHOT'; snapshot: BridgeSnapshot }
  | { ns: typeof BRIDGE_NAMESPACE; kind: 'PENDING_TEXT'; text: string }
  // MAIN → ISOLATED
  | { ns: typeof BRIDGE_NAMESPACE; kind: 'MEMORIES_USED'; ids: number[] }
  | { ns: typeof BRIDGE_NAMESPACE; kind: 'MEMORY_SAVE_REQUEST'; skillName: string; content: string }
  | { ns: typeof BRIDGE_NAMESPACE; kind: 'ACTIVE_SKILL'; name: string | null }
  | { ns: typeof BRIDGE_NAMESPACE; kind: 'MSG_COUNT'; count: number };

export type BridgeMessageBody =
  | { kind: 'SNAPSHOT'; snapshot: BridgeSnapshot }
  | { kind: 'PENDING_TEXT'; text: string }
  | { kind: 'MEMORIES_USED'; ids: number[] }
  | { kind: 'MEMORY_SAVE_REQUEST'; skillName: string; content: string }
  | { kind: 'ACTIVE_SKILL'; name: string | null }
  | { kind: 'MSG_COUNT'; count: number };

/** 向同页另一 world 广播一条桥接消息。 */
export function postBridge(body: BridgeMessageBody): void {
  const message = { ns: BRIDGE_NAMESPACE, ...body } as BridgeMessage;
  window.postMessage(message, window.location.origin);
}

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as { ns?: unknown }).ns === BRIDGE_NAMESPACE &&
    typeof (data as { kind?: unknown }).kind === 'string'
  );
}
