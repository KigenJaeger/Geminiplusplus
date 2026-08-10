import type { GitHubImportResult, GitHubSkillPreview } from '../../core/skill/github-importer';
import type { SkillGithubMeta } from '../../core/types';
import type { ExportedConversation } from '../../core/gemini/conversation-export';
import type { Project } from '../../core/types';

// 侧边栏 runtime 客户端：封装 chrome.runtime 通信 + BG_ 命令
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
}

export interface SkillRecord {
  name: string;
  description: string;
  instructions: string;
  source: 'builtin' | 'custom';
  memoryEnabled: boolean;
  memoryWriteEnabled?: boolean;
  enabled?: boolean;
  github?: SkillGithubMeta;
}

export interface PresetRecord {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface InjectionSettings {
  memoryEnabled: boolean;
  presetEnabled: boolean;
  presetCadence: 'first_message' | 'every_message' | 'off';
  skillInjectionEnabled: boolean;
}

export interface GeminiPageState {
  activeSkill: { name: string } | null;
  messageCount: number;
  hasGeminiPage: boolean;
}

export function sendBackground<T>(message: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? 'runtime error'));
        return;
      }
      if (response && typeof response === 'object' && 'ok' in response && (response as { ok: boolean }).ok === false) {
        reject(new Error((response as { error?: string }).error ?? 'command failed'));
        return;
      }
      resolve(response as T);
    });
  });
}

export const api = {
  getState: () => sendBackground<{ state: GeminiPageState }>({ type: 'GET_STATE', requestId: Date.now() }),
  getMemories: () => sendBackground<{ memories: MemoryRecord[] }>({ type: 'BG_GET_MEMORIES' }),
  saveMemory: (memory: Omit<MemoryRecord, 'id' | 'createdAt' | 'updatedAt'>) =>
    sendBackground<{ id: number }>({ type: 'BG_MEMORY_SAVE', memory }),
  deleteMemory: (id: number) => sendBackground<{ ok: true }>({ type: 'BG_MEMORY_DELETE', id }),

  getSkills: () => sendBackground<{ skills: SkillRecord[] }>({ type: 'BG_GET_SKILLS' }),
  saveSkill: (skill: { name: string; description: string; instructions: string; memoryEnabled: boolean; memoryWriteEnabled?: boolean }, previousName?: string) =>
    sendBackground<{ ok: true }>({ type: 'BG_SAVE_SKILL', ...skill, previousName }),
  deleteSkill: (name: string) => sendBackground<{ ok: true }>({ type: 'BG_DELETE_SKILL', name }),
  setSkillEnabled: (name: string, enabled: boolean) =>
    sendBackground<{ ok: true }>({ type: 'BG_SET_SKILL_ENABLED', name, enabled }),

  previewGitHubSkill: (url: string) =>
    sendBackground<{ preview: GitHubSkillPreview }>({ type: 'BG_PREVIEW_GITHUB_SKILL', url }),
  importGitHubSkill: (url: string, selectedPaths: string[]) =>
    sendBackground<{ result: GitHubImportResult }>({ type: 'BG_IMPORT_GITHUB_SKILL', url, selectedPaths }),

  getPresets: () => sendBackground<{ presets: PresetRecord[]; activePresetId: string | null }>({ type: 'BG_GET_PRESETS' }),
  savePreset: (preset: { name: string; content: string }, id?: string) =>
    sendBackground<{ preset: PresetRecord }>({ type: 'BG_SAVE_PRESET', ...preset, id }),
  deletePreset: (id: string) => sendBackground<{ ok: true }>({ type: 'BG_DELETE_PRESET', id }),
  setActivePreset: (id: string | null) => sendBackground<{ ok: true }>({ type: 'BG_SET_ACTIVE_PRESET', id }),

  getProjects: () => sendBackground<{ projects: Project[]; activeProjectId: string | null; pendingProjectId: string | null; conversations: Array<{ conversationId: string; projectId: string; title: string; url: string }> }>({ type: 'BG_GET_PROJECTS' }),
  saveProject: (project: { name: string; description: string; instructions: string }, id?: string) => sendBackground<{ project: Project }>({ type: 'BG_SAVE_PROJECT', ...project, id }),
  deleteProject: (id: string) => sendBackground<{ ok: true }>({ type: 'BG_DELETE_PROJECT', id }),
  setActiveProject: (id: string | null) => sendBackground<{ ok: true }>({ type: 'BG_SET_ACTIVE_PROJECT', id }),
  setPendingProject: (id: string | null) => sendBackground<{ ok: true }>({ type: 'BG_SET_PENDING_PROJECT', id }),

  exportConfig: () => sendBackground<{ backup: unknown }>({ type: 'BG_EXPORT_CONFIG' }),
  importConfig: (backup: unknown, mode: 'merge' | 'replace') => sendBackground<{ ok: true }>({ type: 'BG_IMPORT_CONFIG', backup, mode }),

  getSettings: () => sendBackground<{ settings: InjectionSettings }>({ type: 'BG_GET_SETTINGS' }),
  saveSettings: (settings: Partial<InjectionSettings>) =>
    sendBackground<{ settings: InjectionSettings }>({ type: 'BG_SAVE_SETTINGS', settings }),

  exportConversation: () =>
    sendBackground<{ conversation: ExportedConversation }>({
      type: 'EXPORT_CONVERSATION',
      requestId: Date.now(),
    }),
};
