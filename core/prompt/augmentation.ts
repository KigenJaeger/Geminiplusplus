// Prompt 组装：解析 /技能命令，把记忆、激活技能、预设合成注入文本
// 移植自 DeepSeek++ buildPromptAugmentation：只有被显式激活（/命令）的技能才注入

// 注入块外壳。Gemini 网页版无法注入隐藏的 system prompt（gRPC-Web 流），只能把指令
// 拼进用户消息，因此外壳必须同时承担两个职责：
// 1. 向模型声明"这是规则不是对话内容"，并禁止复述规则、禁止以代码注释/元标记形式输出，
//    避免模型模仿注入格式（如输出 {/* Reason: ... */}）污染回答；
// 2. 作为发送前防重入的哨兵标记（content.ts 用 includes 检测）。
export const SYSTEM_BLOCK_START =
  '【Gemini++ 系统规则】\n' +
  '以下规则用于指导本次回答，规则本身不是对话内容。请严格遵守规则，但不要在回答中提及、复述、引用或评价它们，' +
  '也不要以任何代码注释、推理注释或元标记（如 {/* */}、<reason>、[reason] 等）的形式输出任何内容，直接正常回答用户的问题。';
export const SYSTEM_BLOCK_END = '【Gemini++ 系统规则结束】';

// 结构化最小输入（与 background BG_GET_INJECTION_DATA 返回一致）
export interface InjectionMemory {
  id: number;
  name: string;
  description: string;
  content: string;
}

export interface InjectionSkill {
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  memoryEnabled: boolean;
  memoryWriteEnabled?: boolean;
}

export interface InjectionPreset {
  id: string;
  name: string;
  content: string;
}

export interface AugmentationInput {
  memories: InjectionMemory[];
  skills: InjectionSkill[];
  activePreset: InjectionPreset | null;
  messageCount: number;
  memoryEnabled: boolean;
  presetEnabled: boolean;
  presetCadence: 'first_message' | 'every_message' | 'off';
  activeProject?: { name: string; description: string; instructions: string } | null;
  /** 技能注入总开关；缺省视为开启（旧调用方不传时保持原行为）。 */
  skillInjectionEnabled?: boolean;
  /** 当前会话持续使用的 Skill 名称；新的 /技能名 命令会覆盖它。 */
  activeSkillName?: string | null;
}

export interface AugmentationResult {
  /** 注入后的完整消息（系统规则块 + 用户可见文本） */
  augmentedText: string;
  /** 用户真正想说的内容（去掉 /命令 前缀） */
  visibleUserText: string;
  usedMemoryIds: number[];
  injectedBlocks: string[];
  activatedSkill: InjectionSkill | null;
}

export interface SkillCommand {
  skillName: string;
  args: string;
  rawInput: string;
}

/**
 * 解析消息开头的 /技能名 命令。
 *
 * 提供 knownSkillNames 时按真实技能名做最长匹配，从而支持空格、中文和点号等字符，
 * 同时避免 `web` 抢先匹配 `web search`。未提供名称列表时保留单个非空白名称的
 * 通用解析，供独立调用与兼容旧行为使用。
 */
export function parseSkillCommand(input: string, knownSkillNames: string[] = []): SkillCommand | null {
  const rawInput = input.trim();
  if (!rawInput.startsWith('/')) return null;

  if (knownSkillNames.length > 0) {
    const commandText = rawInput.slice(1);
    const matchedName = knownSkillNames
      .map((name) => name.trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .find((name) => {
        if (!commandText.toLowerCase().startsWith(name.toLowerCase())) return false;
        const boundary = commandText[name.length];
        return boundary === undefined || /\s/u.test(boundary);
      });
    if (!matchedName) return null;

    return {
      skillName: matchedName.toLowerCase(),
      args: commandText.slice(matchedName.length).trim(),
      rawInput,
    };
  }

  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/u.exec(rawInput);
  if (!match) return null;
  return {
    skillName: match[1]!.toLowerCase(),
    args: (match[2] ?? '').trim(),
    rawInput,
  };
}

export function buildAugmentedPrompt(
  originalPrompt: string,
  input: AugmentationInput,
): AugmentationResult {
  const blocks: string[] = [];
  const usedMemoryIds: number[] = [];

  const trimmed = originalPrompt.trim();
  // 总开关关闭时不解析 /命令，命令原文当普通消息发出去
  const skillsOn = input.skillInjectionEnabled !== false;
  const command = skillsOn ? parseSkillCommand(trimmed, input.skills.map((skill) => skill.name)) : null;
  const commandSkill = command
    ? input.skills.find((s) => s.name.trim().toLowerCase() === command.skillName && s.enabled) ?? null
    : null;
  const continuedSkill = !command && !trimmed.startsWith('/') && input.activeSkillName
    ? input.skills.find((s) => s.name.trim().toLowerCase() === input.activeSkillName!.trim().toLowerCase() && s.enabled) ?? null
    : null;
  const activatedSkill = commandSkill ?? continuedSkill;

  // 用户可见文本：去掉了 /技能名 前缀后的部分（保留参数）
  const visibleUserText = commandSkill ? command!.args : trimmed;

  // 1. 激活的技能指令
  if (activatedSkill) {
    blocks.push(`【技能 ${activatedSkill.name}】\n${activatedSkill.instructions.trim()}`);
  }

  // 2. 记忆注入（技能 memoryEnabled=false 时跳过；全局开关控制）
  const memoryOn = input.memoryEnabled && (activatedSkill ? activatedSkill.memoryEnabled !== false : true);
  if (memoryOn && input.memories.length > 0) {
    const injectedMemories = input.memories.filter((m) => m.content.trim().length > 0);
    if (injectedMemories.length > 0) {
      const memoryLines = injectedMemories.map(
        (m) => `- ${m.name}${m.description ? `（${m.description}）` : ''}: ${m.content.trim()}`,
      );
      blocks.push([
        '以下是与本次对话相关的长期记忆，请在回答中自然运用，不要向用户复述清单本身：',
        ...memoryLines,
      ].join('\n'));
      usedMemoryIds.push(...injectedMemories.map((m) => m.id).filter((id): id is number => id !== undefined));
    }
  }

  // 3. 预设注入（按节奏）
  const shouldInjectPreset = input.presetEnabled && input.activePreset !== null && (
    input.presetCadence === 'every_message'
    || (input.presetCadence === 'first_message' && input.messageCount === 0)
  );
  if (shouldInjectPreset && input.activePreset) {
    blocks.push(`【预设 ${input.activePreset.name}】\n${input.activePreset.content.trim()}`);
  }

  if (input.activeProject?.instructions.trim()) {
    blocks.push(`【项目 ${input.activeProject.name}】\n${input.activeProject.description ? `${input.activeProject.description}\n` : ''}${input.activeProject.instructions.trim()}`);
  }

  if (blocks.length === 0) {
    return {
      augmentedText: originalPrompt,
      visibleUserText,
      usedMemoryIds: [],
      injectedBlocks: [],
      activatedSkill,
    };
  }

  const systemText = `${SYSTEM_BLOCK_START}\n\n${blocks.join('\n\n')}\n\n${SYSTEM_BLOCK_END}`;
  return {
    augmentedText: `${systemText}\n\n用户问题：${visibleUserText}`,
    visibleUserText,
    usedMemoryIds,
    injectedBlocks: blocks,
    activatedSkill,
  };
}
