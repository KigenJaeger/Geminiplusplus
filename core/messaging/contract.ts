// Gemini++ 消息协议（runtime 消息契约，移植自 DeepSeek++ 的 runtime-command-registry 思路）
// 说明：content 脚本（ISOLATED world）作为唯一 DOM 访问者；
// sidepanel 通过 background 中转到 content，避免 sidepanel 直接依赖 Gemini DOM。
import type { ExportedConversation } from '../gemini/conversation-export';

export interface MemoryRecord {
  id?: number;
  type: string;
  name: string;
  content: string;
  description: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  lastAccessedAt: number;
}

export interface SkillSummary {
  name: string;
  description: string;
  enabled: boolean;
  source: 'builtin' | 'custom';
}

export interface GemStateSnapshot {
  skills: SkillSummary[];
  memories: MemoryRecord[];
  activePreset: { id: string; name: string } | null;
  settings: {
    memoryEnabled: boolean;
    presetEnabled: boolean;
    presetCadence: string;
    skillInjectionEnabled: boolean;
  };
  messageCount: number;
  activeSkill: { name: string } | null;
  hasGeminiPage: boolean;
}

export type GemMessage =
  | { type: 'CONTENT_READY' }
  | { type: 'BG_REFRESH_INJECTION' }
  | { type: 'GET_STATE'; requestId: number }
  | { type: 'GET_STATE_RESPONSE'; requestId: number; state: GemStateSnapshot }
  | { type: 'MEMORY_SAVE'; memory: { type: string; name: string; content: string; description: string; tags: string[]; pinned: boolean }; requestId: number }
  | { type: 'MEMORY_SAVE_RESPONSE'; requestId: number; ok: boolean; id?: number; error?: string }
  | { type: 'MEMORY_DELETE'; id: number; requestId: number }
  | { type: 'MEMORY_DELETE_RESPONSE'; requestId: number; ok: boolean; error?: string }
  | { type: 'MEMORY_USED'; ids: number[] }
  | { type: 'OPEN_SIDEPANEL' }
  | { type: 'INJECT_PROMPT'; text: string; requestId: number }
  | { type: 'INJECT_PROMPT_RESPONSE'; requestId: number; ok: boolean; error?: string }
  | { type: 'EXPORT_CONVERSATION'; requestId: number }
  | { type: 'EXPORT_CONVERSATION_RESPONSE'; requestId: number; ok: boolean; conversation?: ExportedConversation; error?: string }
  | { type: 'PING' }
  | { type: 'PONG' };

export function createRequestId(): number {
  return Date.now() + Math.floor(Math.random() * 100000);
}
