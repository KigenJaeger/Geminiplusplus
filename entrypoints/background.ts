// Gemini++ background（MV3 service worker）
// 职责：集中存储访问（IndexedDB 记忆 / chrome.storage 技能·预设·设置）；
// 中转 sidepanel ↔ content 消息
import {
  getAllMemories,
  deleteMemory,
  saveMemory,
  touchMemories,
} from '../core/memory/store';
import {
  getAllSkills,
  setSkillEnabled,
  deleteSkill,
  saveSkill,
} from '../core/skill/store';
import { importGitHubSkill, previewGitHubSkill } from '../core/skill/github-importer';
import {
  getAllPresets,
  savePreset,
  deletePreset,
  setActivePresetId,
  getActivePreset,
} from '../core/preset/store';
import { getInjectionSettings, saveInjectionSettings } from '../core/settings/store';
import type { GemMessage } from '../core/messaging/contract';
import { bindPendingProjectConversation, createProject, deleteProject, getProjects, renameProjectConversation, setActiveProjectId, setPendingProjectId, syncProjectConversationTitle, updateProject } from '../core/project/store';
import { exportConfigBackup, importConfigBackup } from '../core/config-backup';

export default defineBackground(() => {
  // 打开侧边栏（工具栏点击）
  chrome.action?.onClicked.addListener(() => {
    void chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT }).catch(() => {
      // Firefox / 不支持时忽略
    });
  });

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as Record<string, unknown>;
    const type = typeof msg?.type === 'string' ? msg.type : '';

    // ---- 注入数据（content script 调用） ----
    if (type === 'BG_GET_INJECTION_DATA') {
      void (async () => {
        try {
          const [skills, memories, activePreset, settings, projectState] = await Promise.all([
            getAllSkills(),
            getAllMemories(),
            getActivePreset(),
            getInjectionSettings(),
            getProjects(),
          ]);
          sendResponse({
            ok: true,
            data: {
              skills: skills.map((s) => ({
                name: s.name,
                description: s.description,
                instructions: s.instructions,
                enabled: s.enabled !== false,
                memoryEnabled: s.memoryEnabled,
                memoryWriteEnabled: s.memoryWriteEnabled,
              })),
              memories: memories.map((m) => ({
                id: m.id as number,
                name: m.name,
                description: m.description,
                content: m.content,
              })),
              activePreset: activePreset
                ? { id: activePreset.id, name: activePreset.name, content: activePreset.content }
                : null,
              activeProject: projectState.projects.find((project) => project.id === projectState.activeProjectId) ?? null,
              settings: {
                memoryEnabled: settings.memoryEnabled,
                presetEnabled: settings.presetEnabled,
                presetCadence: settings.presetCadence,
                skillInjectionEnabled: settings.skillInjectionEnabled,
              },
            },
          });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }
    if (type === 'BG_TOUCH_MEMORIES') {
      void (async () => {
        try {
          const ids = Array.isArray(msg.ids) ? msg.ids.map(Number).filter((n) => Number.isFinite(n)) : [];
          await touchMemories(ids);
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    // ---- sidepanel 记忆命令 ----
    if (type === 'BG_MEMORY_SAVE') {
      void (async () => {
        try {
          const id = await saveMemory(msg.memory as Parameters<typeof saveMemory>[0]);
          void notifyGeminiTabs().catch(() => undefined);
          sendResponse({ ok: true, id });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }
    if (type === 'BG_MEMORY_DELETE') {
      void (async () => {
        try {
          await deleteMemory(Number(msg.id));
          void notifyGeminiTabs().catch(() => undefined);
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }
    if (type === 'BG_GET_MEMORIES') {
      void (async () => {
        try {
          const memories = await getAllMemories();
          sendResponse({ ok: true, memories });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    // ---- sidepanel 技能命令 ----
    if (type === 'BG_GET_SKILLS') {
      void (async () => {
        try {
          const skills = await getAllSkills();
          sendResponse({ ok: true, skills });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }
    if (type === 'BG_SAVE_SKILL') {
      void (async () => {
        try {
          await saveSkill({
            name: String(msg.name ?? ''),
            description: String(msg.description ?? ''),
            instructions: String(msg.instructions ?? ''),
            memoryEnabled: msg.memoryEnabled === true,
            memoryWriteEnabled: typeof msg.memoryWriteEnabled === 'boolean' ? msg.memoryWriteEnabled : undefined,
          }, typeof msg.previousName === 'string' ? msg.previousName : undefined);
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }
    if (type === 'BG_DELETE_SKILL') {
      void (async () => {
        try {
          await deleteSkill(String(msg.name));
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }
    if (type === 'BG_SET_SKILL_ENABLED') {
      void (async () => {
        try {
          await setSkillEnabled(String(msg.name), msg.enabled === true);
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    // 页面里的项目母录点“管理项目”时，从 background 打开侧边栏（content script 没有 sidePanel 权限）
    if (type === 'OPEN_SIDEPANEL') {
      void chrome.sidePanel
        .open({ windowId: chrome.windows.WINDOW_ID_CURRENT })
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }

    if (type === 'BG_GET_PROJECTS') {
      void getProjects().then((projects) => sendResponse({ ok: true, ...projects })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (type === 'BG_SAVE_PROJECT') {
      void (async () => {
        try {
          const input = { name: String(msg.name ?? ''), description: String(msg.description ?? ''), instructions: String(msg.instructions ?? '') };
          const project = typeof msg.id === 'string' ? await updateProject(msg.id, input) : await createProject(input);
          if (typeof msg.id !== 'string') {
            await setActiveProjectId(project.id);
            const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
            const currentId = /^https:\/\/gemini\.google\.com\/app\/([^/?#]+)/.exec(tabs[0]?.url ?? '')?.[1] ?? '';
            await setPendingProjectId(project.id, currentId);
          }
          void notifyGeminiTabs().catch(() => undefined);
          sendResponse({ ok: true, project });
        } catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
      })();
      return true;
    }
    if (type === 'BG_DELETE_PROJECT') {
      void deleteProject(String(msg.id)).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (type === 'BG_SET_ACTIVE_PROJECT') {
      void setActiveProjectId(msg.id === null ? null : String(msg.id)).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (type === 'BG_SET_PENDING_PROJECT') {
      void (async () => {
        try {
          const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          const currentId = /^https:\/\/gemini\.google\.com\/app\/([^/?#]+)/.exec(tabs[0]?.url ?? '')?.[1] ?? '';
          await setPendingProjectId(msg.id === null ? null : String(msg.id), currentId);
          sendResponse({ ok: true });
        } catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
      })();
      return true;
    }
    if (type === 'BG_BIND_PENDING_PROJECT') {
      void bindPendingProjectConversation({ conversationId: String(msg.conversationId ?? ''), title: String(msg.title ?? ''), url: String(msg.url ?? '') }).then((conversation) => sendResponse({ ok: true, conversation })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    // 用户在母录里手动改子对话名字：写入并锁定，之后 Gemini 自己改名也不会覆盖
    if (type === 'BG_RENAME_PROJECT_CONVERSATION') {
      void renameProjectConversation(String(msg.conversationId ?? ''), String(msg.title ?? '')).then((conversation) => sendResponse({ ok: true, conversation })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    // Gemini 给对话起名后由 content script 上报，跟随更新（用户改过名的除外）
    if (type === 'BG_SYNC_CONVERSATION_TITLE') {
      void syncProjectConversationTitle(String(msg.conversationId ?? ''), String(msg.title ?? '')).then((conversation) => sendResponse({ ok: true, conversation })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (type === 'BG_EXPORT_CONFIG') {
      void exportConfigBackup().then((backup) => sendResponse({ ok: true, backup })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }
    if (type === 'BG_IMPORT_CONFIG') {
      void importConfigBackup(msg.backup, msg.mode === 'replace' ? 'replace' : 'merge').then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }

    // ---- GitHub Skill 导入 ----
    if (type === 'BG_PREVIEW_GITHUB_SKILL') {
      void (async () => {
        try {
          const preview = await previewGitHubSkill(String(msg.url ?? ''));
          sendResponse({ ok: true, preview });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }
    if (type === 'BG_IMPORT_GITHUB_SKILL') {
      void (async () => {
        try {
          const selectedPaths = Array.isArray(msg.selectedPaths) ? msg.selectedPaths.map(String) : [];
          const result = await importGitHubSkill({ url: String(msg.url ?? ''), selectedPaths });
          sendResponse({ ok: true, result });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    // ---- sidepanel 预设命令 ----
    if (type === 'BG_GET_PRESETS') {
      void (async () => {
        try {
          const presets = await getAllPresets();
          const active = await getActivePreset();
          sendResponse({ ok: true, presets, activePresetId: active?.id ?? null });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }
    if (type === 'BG_SAVE_PRESET') {
      void (async () => {
        try {
          const preset = await savePreset({
            name: String(msg.name ?? ''),
            content: String(msg.content ?? ''),
          }, typeof msg.id === 'string' ? msg.id : undefined);
          sendResponse({ ok: true, preset });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }
    if (type === 'BG_DELETE_PRESET') {
      void (async () => {
        try {
          await deletePreset(String(msg.id));
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }
    if (type === 'BG_SET_ACTIVE_PRESET') {
      void (async () => {
        try {
          await setActivePresetId(msg.id === null || msg.id === undefined ? null : String(msg.id));
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    // ---- sidepanel 设置命令 ----
    if (type === 'BG_GET_SETTINGS') {
      void (async () => {
        try {
          const settings = await getInjectionSettings();
          sendResponse({ ok: true, settings });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }
    if (type === 'BG_SAVE_SETTINGS') {
      void (async () => {
        try {
          const settings = await saveInjectionSettings(msg.settings as Record<string, unknown>);
          sendResponse({ ok: true, settings });
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
      return true;
    }

    // ---- content 中转：GET_STATE / INJECT_PROMPT（sidepanel 转给活动标签页） ----
    if (type === 'GET_STATE' || type === 'INJECT_PROMPT') {
      void (async () => {
        const emptyState = {
          type: 'GET_STATE_RESPONSE',
          requestId: Number(msg.requestId),
          state: {
            skills: [], memories: [], activePreset: null,
            settings: { memoryEnabled: true, presetEnabled: true, presetCadence: 'first_message', skillInjectionEnabled: true },
            messageCount: 0, activeSkill: null, hasGeminiPage: false,
          },
        };
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tab = tabs[0];
          if (!tab?.id) { sendResponse(emptyState); return; }
          chrome.tabs.sendMessage(tab.id, msg as GemMessage, (response) => {
            if (chrome.runtime.lastError || !response) { sendResponse(emptyState); return; }
            sendResponse(response);
          });
        } catch {
          sendResponse(emptyState);
        }
      })();
      return true;
    }

    // ---- content 中转：EXPORT_CONVERSATION（在活动标签页抓取当前会话 DOM） ----
    if (type === 'EXPORT_CONVERSATION') {
      void (async () => {
        const fail = (error: string) => sendResponse({
          type: 'EXPORT_CONVERSATION_RESPONSE',
          requestId: Number(msg.requestId),
          ok: false,
          error,
        });
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const tab = tabs[0];
          if (!tab?.id) { fail('未找到活动标签页'); return; }
          if (!/^https:\/\/gemini\.google\.com\//.test(tab.url ?? '')) {
            fail('请在 Gemini 网页（gemini.google.com）中打开一个会话后再导出');
            return;
          }
          chrome.tabs.sendMessage(tab.id, msg as GemMessage, (response) => {
            if (chrome.runtime.lastError || !response) {
              fail(chrome.runtime.lastError?.message ?? '内容脚本无响应，请刷新 Gemini 页面后重试');
              return;
            }
            sendResponse(response);
          });
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
        }
      })();
      return true;
    }

    return;
  });

  console.log('[Gemini++] background ready');
});

async function notifyGeminiTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
  await Promise.all(tabs.filter((tab) => tab.id !== undefined).map((tab) => new Promise<void>((resolve) => {
    chrome.tabs.sendMessage(tab.id!, { type: 'BG_REFRESH_INJECTION' }, () => { void chrome.runtime.lastError; resolve(); });
  })));
}
