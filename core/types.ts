// Gemini++ 核心类型定义（移植自 DeepSeek++，去掉 DeepSeek 特有字段）

export type MemoryType = 'user' | 'feedback' | 'topic' | 'reference';

export interface Memory {
  id?: number;
  syncId: string;
  type: MemoryType;
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

export type NewMemory = Omit<
  Memory,
  'id' | 'syncId' | 'createdAt' | 'updatedAt' | 'accessCount' | 'lastAccessedAt'
> & { syncId?: string };

export type SkillSource = 'builtin' | 'custom';

/** 从 GitHub 导入的技能元数据（用于识别来源与重导更新） */
export interface SkillGithubMeta {
  sourceUrl: string;
  repository: string;
  path: string;
  commitSha: string;
  license: string;
  version?: string;
}

export interface Skill {
  name: string;
  description: string;
  instructions: string;
  source: SkillSource;
  memoryEnabled: boolean;
  /** Whether invoking this Skill stores the command body as a durable memory. */
  memoryWriteEnabled?: boolean;
  enabled?: boolean;
  github?: SkillGithubMeta;
}

export type NewSkill = Omit<Skill, 'source' | 'enabled'> & { enabled?: boolean };

export interface SystemPromptPreset {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export type NewPreset = Omit<SystemPromptPreset, 'id' | 'createdAt' | 'updatedAt'>;

export type PresetCadence = 'first_message' | 'every_message' | 'off';

export interface PromptInjectionSettings {
  memoryEnabled: boolean;
  presetEnabled: boolean;
  presetCadence: PresetCadence;
  skillInjectionEnabled: boolean;
}

export type GeminiTheme = 'light' | 'dark';

/** A local work area whose instructions are added to messages sent from Gemini. */
export interface Project {
  id: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectConversation {
  conversationId: string;
  projectId: string;
  title: string;
  url: string;
  addedAt: number;
  lastSeenAt: number;
  /** 用户手动改过名字：为 true 时不再被 Gemini 自己的对话标题覆盖 */
  titleLocked?: boolean;
}
