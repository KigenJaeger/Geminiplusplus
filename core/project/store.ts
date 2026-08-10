import type { Project, ProjectConversation } from '../types';
import { FALLBACK_CONVERSATION_TITLE, normalizeConversationTitle, sanitizeManualTitle, shouldSyncTitle } from './title';

const PROJECTS_KEY = 'gemini_pp_projects';
const ACTIVE_PROJECT_ID_KEY = 'gemini_pp_active_project_id';
const PROJECT_CONVERSATIONS_KEY = 'gemini_pp_project_conversations';
const PENDING_PROJECT_ID_KEY = 'gemini_pp_pending_project_id';
const PENDING_EXCLUDED_CONVERSATION_KEY = 'gemini_pp_pending_excluded_conversation_id';

let mutationQueue = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(operation, operation);
  mutationQueue = run.then(() => undefined, () => undefined);
  return run;
}

function readProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Project => {
    if (!item || typeof item !== 'object') return false;
    const project = item as Partial<Project>;
    return typeof project.id === 'string' && typeof project.name === 'string' &&
      typeof project.description === 'string' && typeof project.instructions === 'string' &&
      Number.isFinite(project.createdAt) && Number.isFinite(project.updatedAt);
  });
}

function requiredName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error('项目名称不能为空');
  return name.slice(0, 120);
}

export async function getProjects(): Promise<{ projects: Project[]; activeProjectId: string | null; pendingProjectId: string | null; conversations: ProjectConversation[] }> {
  const data = await chrome.storage.local.get([PROJECTS_KEY, ACTIVE_PROJECT_ID_KEY, PENDING_PROJECT_ID_KEY, PENDING_EXCLUDED_CONVERSATION_KEY, PROJECT_CONVERSATIONS_KEY]);
  const projects = readProjects(data[PROJECTS_KEY]).sort((a, b) => b.updatedAt - a.updatedAt);
  const activeProjectId = typeof data[ACTIVE_PROJECT_ID_KEY] === 'string' && projects.some((p) => p.id === data[ACTIVE_PROJECT_ID_KEY])
    ? data[ACTIVE_PROJECT_ID_KEY] : null;
  const projectIds = new Set(projects.map((project) => project.id));
  const conversations = Array.isArray(data[PROJECT_CONVERSATIONS_KEY]) ? (data[PROJECT_CONVERSATIONS_KEY] as ProjectConversation[]).filter((item) => projectIds.has(item.projectId) && typeof item.conversationId === 'string') : [];
  const pendingProjectId = typeof data[PENDING_PROJECT_ID_KEY] === 'string' && projectIds.has(data[PENDING_PROJECT_ID_KEY] as string) ? data[PENDING_PROJECT_ID_KEY] as string : null;
  return { projects, activeProjectId, pendingProjectId, conversations };
}

export async function createProject(input: Pick<Project, 'name' | 'description' | 'instructions'>): Promise<Project> {
  return serialize(async () => {
    const data = await chrome.storage.local.get(PROJECTS_KEY);
    const now = Date.now();
    const project: Project = { id: crypto.randomUUID(), name: requiredName(input.name), description: input.description.trim(), instructions: input.instructions.trim(), createdAt: now, updatedAt: now };
    await chrome.storage.local.set({ [PROJECTS_KEY]: [...readProjects(data[PROJECTS_KEY]), project] });
    return project;
  });
}

export async function updateProject(id: string, input: Pick<Project, 'name' | 'description' | 'instructions'>): Promise<Project> {
  return serialize(async () => {
    const data = await chrome.storage.local.get(PROJECTS_KEY);
    const projects = readProjects(data[PROJECTS_KEY]);
    const current = projects.find((project) => project.id === id);
    if (!current) throw new Error('项目不存在');
    const next = { ...current, name: requiredName(input.name), description: input.description.trim(), instructions: input.instructions.trim(), updatedAt: Date.now() };
    await chrome.storage.local.set({ [PROJECTS_KEY]: projects.map((project) => project.id === id ? next : project) });
    return next;
  });
}

export async function deleteProject(id: string): Promise<void> {
  await serialize(async () => {
    const data = await chrome.storage.local.get([PROJECTS_KEY, ACTIVE_PROJECT_ID_KEY, PENDING_PROJECT_ID_KEY, PROJECT_CONVERSATIONS_KEY]);
    const patch: Record<string, unknown> = {
      [PROJECTS_KEY]: readProjects(data[PROJECTS_KEY]).filter((project) => project.id !== id),
      [PROJECT_CONVERSATIONS_KEY]: Array.isArray(data[PROJECT_CONVERSATIONS_KEY]) ? (data[PROJECT_CONVERSATIONS_KEY] as ProjectConversation[]).filter((item) => item.projectId !== id) : [],
    };
    if (data[ACTIVE_PROJECT_ID_KEY] === id) patch[ACTIVE_PROJECT_ID_KEY] = null;
    if (data[PENDING_PROJECT_ID_KEY] === id) patch[PENDING_PROJECT_ID_KEY] = null;
    await chrome.storage.local.set(patch);
  });
}

export async function setActiveProjectId(id: string | null): Promise<void> {
  await serialize(async () => {
    if (id !== null && !(await getProjects()).projects.some((project) => project.id === id)) throw new Error('项目不存在');
    await chrome.storage.local.set({ [ACTIVE_PROJECT_ID_KEY]: id });
  });
}

export async function setPendingProjectId(id: string | null, excludedConversationId = ''): Promise<void> {
  await serialize(async () => {
    if (id !== null && !(await getProjects()).projects.some((project) => project.id === id)) throw new Error('项目不存在');
    await chrome.storage.local.set({ [PENDING_PROJECT_ID_KEY]: id, [PENDING_EXCLUDED_CONVERSATION_KEY]: id ? excludedConversationId : '' });
  });
}

export async function bindPendingProjectConversation(input: { conversationId: string; title: string; url: string }): Promise<ProjectConversation | null> {
  return serialize(async () => {
    const state = await getProjects();
    const pendingData = await chrome.storage.local.get(PENDING_EXCLUDED_CONVERSATION_KEY);
    if (!state.pendingProjectId || !input.conversationId.trim() || pendingData[PENDING_EXCLUDED_CONVERSATION_KEY] === input.conversationId.trim()) return null;
    const now = Date.now();
    const conversation: ProjectConversation = { conversationId: input.conversationId.trim(), projectId: state.pendingProjectId, title: normalizeConversationTitle(input.title) || FALLBACK_CONVERSATION_TITLE, url: input.url.trim(), addedAt: state.conversations.find((item) => item.conversationId === input.conversationId)?.addedAt ?? now, lastSeenAt: now };
    const next = [...state.conversations.filter((item) => item.conversationId !== conversation.conversationId), conversation];
    await chrome.storage.local.set({ [PROJECT_CONVERSATIONS_KEY]: next, [PENDING_PROJECT_ID_KEY]: null, [PENDING_EXCLUDED_CONVERSATION_KEY]: '' });
    return conversation;
  });
}

/** 用户手动改名：写入并锁定，之后不再被 Gemini 的对话标题覆盖。 */
export async function renameProjectConversation(conversationId: string, title: string): Promise<ProjectConversation | null> {
  return serialize(async () => {
    // 手动改名走无损清洗，别把用户名字里的「- Gemini」当站点后缀剥掉
    const name = sanitizeManualTitle(title);
    if (!name) throw new Error('对话名称不能为空');
    const data = await chrome.storage.local.get(PROJECT_CONVERSATIONS_KEY);
    const conversations = Array.isArray(data[PROJECT_CONVERSATIONS_KEY]) ? data[PROJECT_CONVERSATIONS_KEY] as ProjectConversation[] : [];
    const current = conversations.find((item) => item.conversationId === conversationId);
    if (!current) return null;
    const next: ProjectConversation = { ...current, title: name, titleLocked: true };
    await chrome.storage.local.set({ [PROJECT_CONVERSATIONS_KEY]: conversations.map((item) => item.conversationId === conversationId ? next : item) });
    return next;
  });
}

/** 跟随 Gemini 自己给对话起的名字；用户改过名（titleLocked）就不动。 */
export async function syncProjectConversationTitle(conversationId: string, pageTitle: string): Promise<ProjectConversation | null> {
  return serialize(async () => {
    const data = await chrome.storage.local.get(PROJECT_CONVERSATIONS_KEY);
    const conversations = Array.isArray(data[PROJECT_CONVERSATIONS_KEY]) ? data[PROJECT_CONVERSATIONS_KEY] as ProjectConversation[] : [];
    const current = conversations.find((item) => item.conversationId === conversationId);
    if (!current) return null;
    if (!shouldSyncTitle({ storedTitle: current.title, incomingTitle: pageTitle, titleLocked: current.titleLocked })) return null;
    const title = normalizeConversationTitle(pageTitle);
    const next: ProjectConversation = { ...current, title, lastSeenAt: Date.now() };
    await chrome.storage.local.set({ [PROJECT_CONVERSATIONS_KEY]: conversations.map((item) => item.conversationId === conversationId ? next : item) });
    return next;
  });
}

export async function replaceProjects(projects: Project[], activeProjectId: string | null): Promise<void> {
  await serialize(async () => {
    const clean = readProjects(projects);
    await chrome.storage.local.set({ [PROJECTS_KEY]: clean, [ACTIVE_PROJECT_ID_KEY]: clean.some((project) => project.id === activeProjectId) ? activeProjectId : null, [PENDING_PROJECT_ID_KEY]: null, [PENDING_EXCLUDED_CONVERSATION_KEY]: '', [PROJECT_CONVERSATIONS_KEY]: [] });
  });
}
