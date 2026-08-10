// 项目侧栏视图模型（纯函数，无 DOM / chrome 依赖，便于单测）
//
// 把 storage 里扁平的 projects + conversations 组装成"项目母录 → 下属对话"的树，
// 顺带标出当前正在看的是哪个对话、哪个项目正在等待接收下一次新对话。

import type { Project, ProjectConversation } from '../types';

export interface ProjectSidebarConversation {
  conversationId: string;
  title: string;
  url: string;
  /** 是否就是当前地址栏里这个对话 */
  isCurrent: boolean;
}

export interface ProjectSidebarNode {
  id: string;
  name: string;
  description: string;
  conversations: ProjectSidebarConversation[];
  /** 项目指令是否正在注入 */
  isActive: boolean;
  /** 下一次新对话是否会归入本项目 */
  isPending: boolean;
  /** 当前对话是否属于本项目（用于默认展开） */
  containsCurrent: boolean;
}

export interface ProjectSidebarInput {
  projects: Project[];
  conversations: ProjectConversation[];
  activeProjectId: string | null;
  pendingProjectId: string | null;
  /** 当前 URL 里的对话 ID；不在对话页时传空串 */
  currentConversationId: string;
}

/** 从 Gemini 的 URL 里取出对话 ID；不是对话页时返回空串。 */
export function parseConversationId(pathname: string): string {
  return /^\/app\/([^/?#]+)/.exec(pathname)?.[1] ?? '';
}

export function buildProjectSidebarModel(input: ProjectSidebarInput): ProjectSidebarNode[] {
  const { projects, conversations, activeProjectId, pendingProjectId, currentConversationId } = input;

  // 先按项目分组，避免每个项目都全量 filter 一遍
  const byProject = new Map<string, ProjectConversation[]>();
  for (const conversation of conversations) {
    const bucket = byProject.get(conversation.projectId);
    if (bucket) bucket.push(conversation);
    else byProject.set(conversation.projectId, [conversation]);
  }

  return projects.map((project) => {
    const own = (byProject.get(project.id) ?? [])
      .slice()
      // 最近看过的排在前面；同时间用标题兜底，保证顺序稳定
      .sort((a, b) => (b.lastSeenAt - a.lastSeenAt) || a.title.localeCompare(b.title));

    const items: ProjectSidebarConversation[] = own.map((conversation) => ({
      conversationId: conversation.conversationId,
      title: conversation.title.trim() || 'Gemini 对话',
      url: conversation.url,
      isCurrent: currentConversationId !== '' && conversation.conversationId === currentConversationId,
    }));

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      conversations: items,
      isActive: project.id === activeProjectId,
      isPending: project.id === pendingProjectId,
      containsCurrent: items.some((item) => item.isCurrent),
    };
  });
}
