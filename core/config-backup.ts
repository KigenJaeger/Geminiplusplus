import type { Project, ProjectConversation, Skill, SystemPromptPreset } from './types';
import { getCustomSkills, setCustomSkills } from './skill/store';
import { getActivePresetId, getAllPresets } from './preset/store';
import { getInjectionSettings, saveInjectionSettings } from './settings/store';
import { getProjects, replaceProjects } from './project/store';

const BACKUP_VERSION = 1;

export interface ConfigBackup {
  format: 'gemini-plus-plus-config';
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  skills: Skill[];
  presets: SystemPromptPreset[];
  activePresetId: string | null;
  settings: Awaited<ReturnType<typeof getInjectionSettings>>;
  projects: Project[];
  activeProjectId: string | null;
  pendingProjectId: string | null;
  projectConversations: ProjectConversation[];
}

export async function exportConfigBackup(): Promise<ConfigBackup> {
  const [skills, presets, activePresetId, settings, projectState] = await Promise.all([
    getCustomSkills(), getAllPresets(), getActivePresetId(), getInjectionSettings(), getProjects(),
  ]);
  return { format: 'gemini-plus-plus-config', version: BACKUP_VERSION, exportedAt: Date.now(), skills, presets, activePresetId, settings, projects: projectState.projects, activeProjectId: projectState.activeProjectId, pendingProjectId: projectState.pendingProjectId, projectConversations: projectState.conversations };
}

function arrayOfObjects(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error(`备份中的 ${field} 格式无效`);
  return value as Record<string, unknown>[];
}

export async function importConfigBackup(value: unknown, mode: 'merge' | 'replace'): Promise<void> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请选择有效的 Gemini++ 配置备份文件');
  const backup = value as Record<string, unknown>;
  if (backup.format !== 'gemini-plus-plus-config' || backup.version !== BACKUP_VERSION) throw new Error('不支持的配置备份版本');
  const skills = arrayOfObjects(backup.skills, 'skills') as unknown as Skill[];
  const presets = arrayOfObjects(backup.presets, 'presets') as unknown as SystemPromptPreset[];
  const projects = arrayOfObjects(backup.projects, 'projects') as unknown as Project[];
  const activeProjectId = typeof backup.activeProjectId === 'string' ? backup.activeProjectId : null;
  const pendingProjectId = typeof backup.pendingProjectId === 'string' ? backup.pendingProjectId : null;
  const projectConversations = backup.projectConversations === undefined ? [] : arrayOfObjects(backup.projectConversations, 'projectConversations') as unknown as ProjectConversation[];
  if (mode === 'replace') {
    await setCustomSkills(skills);
    await chrome.storage.local.set({ gemini_pp_presets: presets, gemini_pp_active_preset_id: typeof backup.activePresetId === 'string' ? backup.activePresetId : null });
    await replaceProjects(projects, activeProjectId);
    await chrome.storage.local.set({ gemini_pp_pending_project_id: pendingProjectId, gemini_pp_project_conversations: projectConversations });
  } else {
    const [existingSkills, existingPresets, currentProjects] = await Promise.all([getCustomSkills(), getAllPresets(), getProjects()]);
    const skillMap = new Map(existingSkills.map((skill) => [skill.name, skill]));
    skills.forEach((skill) => skillMap.set(skill.name, skill));
    const presetMap = new Map(existingPresets.map((preset) => [preset.id, preset]));
    presets.forEach((preset) => presetMap.set(preset.id, preset));
    const projectMap = new Map(currentProjects.projects.map((project) => [project.id, project]));
    projects.forEach((project) => projectMap.set(project.id, project));
    await setCustomSkills([...skillMap.values()]);
    await chrome.storage.local.set({ gemini_pp_presets: [...presetMap.values()] });
    await replaceProjects([...projectMap.values()], activeProjectId ?? currentProjects.activeProjectId);
    await chrome.storage.local.set({ gemini_pp_pending_project_id: pendingProjectId ?? currentProjects.pendingProjectId, gemini_pp_project_conversations: [...currentProjects.conversations, ...projectConversations.filter((item) => !currentProjects.conversations.some((old) => old.conversationId === item.conversationId))] });
  }
  await saveInjectionSettings(backup.settings && typeof backup.settings === 'object' ? backup.settings as Record<string, unknown> : {});
}
