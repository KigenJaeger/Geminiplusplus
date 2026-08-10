import { describe, expect, it } from 'vitest';
import { buildProjectSidebarModel, parseConversationId } from '../core/project/sidebar-model';
import type { Project, ProjectConversation } from '../core/types';

function project(id: string, name: string, updatedAt = 0): Project {
  return { id, name, description: `${name} 说明`, instructions: '', createdAt: 0, updatedAt };
}

function conversation(
  projectId: string,
  conversationId: string,
  title: string,
  lastSeenAt: number,
): ProjectConversation {
  return {
    projectId,
    conversationId,
    title,
    url: `https://gemini.google.com/app/${conversationId}`,
    addedAt: 0,
    lastSeenAt,
  };
}

describe('parseConversationId', () => {
  it('从 /app/<id> 取出对话 id', () => {
    expect(parseConversationId('/app/abc123')).toBe('abc123');
  });

  it('忽略 query 和 hash', () => {
    expect(parseConversationId('/app/abc123?x=1')).toBe('abc123');
    expect(parseConversationId('/app/abc123#top')).toBe('abc123');
  });

  it('不在对话页时返回空串', () => {
    expect(parseConversationId('/app')).toBe('');
    expect(parseConversationId('/')).toBe('');
    expect(parseConversationId('/u/0/app')).toBe('');
  });
});

describe('buildProjectSidebarModel', () => {
  it('把对话挂到各自的项目母录下，保持项目输入顺序', () => {
    const nodes = buildProjectSidebarModel({
      projects: [project('p1', '前端重构'), project('p2', '论文')],
      conversations: [
        conversation('p2', 'c3', '文献综述', 30),
        conversation('p1', 'c1', '拆分组件', 10),
        conversation('p1', 'c2', '状态管理', 20),
      ],
      activeProjectId: null,
      pendingProjectId: null,
      currentConversationId: '',
    });

    expect(nodes.map((n) => n.id)).toEqual(['p1', 'p2']);
    // 同项目内按 lastSeenAt 倒序
    expect(nodes[0]!.conversations.map((c) => c.conversationId)).toEqual(['c2', 'c1']);
    expect(nodes[1]!.conversations.map((c) => c.conversationId)).toEqual(['c3']);
  });

  it('lastSeenAt 相同时按标题排序，保证顺序稳定', () => {
    const nodes = buildProjectSidebarModel({
      projects: [project('p1', '项目')],
      conversations: [
        conversation('p1', 'cb', 'B 对话', 5),
        conversation('p1', 'ca', 'A 对话', 5),
      ],
      activeProjectId: null,
      pendingProjectId: null,
      currentConversationId: '',
    });

    expect(nodes[0]!.conversations.map((c) => c.title)).toEqual(['A 对话', 'B 对话']);
  });

  it('标记激活项目、待接收项目和当前对话', () => {
    const nodes = buildProjectSidebarModel({
      projects: [project('p1', '甲'), project('p2', '乙')],
      conversations: [conversation('p1', 'c1', '甲的对话', 1), conversation('p2', 'c2', '乙的对话', 1)],
      activeProjectId: 'p1',
      pendingProjectId: 'p2',
      currentConversationId: 'c2',
    });

    const [p1, p2] = nodes;
    expect(p1!.isActive).toBe(true);
    expect(p1!.isPending).toBe(false);
    expect(p1!.containsCurrent).toBe(false);

    expect(p2!.isActive).toBe(false);
    expect(p2!.isPending).toBe(true);
    // 当前对话属于 p2 → 默认展开靠这个标记
    expect(p2!.containsCurrent).toBe(true);
    expect(p2!.conversations[0]!.isCurrent).toBe(true);
    expect(p1!.conversations[0]!.isCurrent).toBe(false);
  });

  it('空项目也出现在列表里，对话数为 0', () => {
    const nodes = buildProjectSidebarModel({
      projects: [project('p1', '空项目')],
      conversations: [],
      activeProjectId: null,
      pendingProjectId: null,
      currentConversationId: '',
    });

    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.conversations).toEqual([]);
  });

  it('忽略指向已删除项目的孤儿对话', () => {
    const nodes = buildProjectSidebarModel({
      projects: [project('p1', '存在的项目')],
      conversations: [conversation('gone', 'c9', '孤儿对话', 1)],
      activeProjectId: null,
      pendingProjectId: null,
      currentConversationId: '',
    });

    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.conversations).toEqual([]);
  });

  it('标题为空时给出兜底文案', () => {
    const nodes = buildProjectSidebarModel({
      projects: [project('p1', '项目')],
      conversations: [conversation('p1', 'c1', '   ', 1)],
      activeProjectId: null,
      pendingProjectId: null,
      currentConversationId: '',
    });

    expect(nodes[0]!.conversations[0]!.title).toBe('Gemini 对话');
  });

  it('没有项目时返回空数组', () => {
    expect(
      buildProjectSidebarModel({
        projects: [],
        conversations: [conversation('p1', 'c1', '对话', 1)],
        activeProjectId: null,
        pendingProjectId: null,
        currentConversationId: 'c1',
      }),
    ).toEqual([]);
  });
});
