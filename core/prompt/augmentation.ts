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

/** 解析消息开头的 /技能名 命令 */
export function parseSkillCommand(input: string): SkillCommand | null {
  const match = /^\/([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i.exec(input.trim());
  if (!match) return null;
  const skillName = match[1]!.toLowerCase();
  const args = (match[2] ?? '').trim();
  return { skillName, args, rawInput: input.trim() };
}

export function buildAugmentedPrompt(
  originalPrompt: string,
  input: AugmentationInput,
): AugmentationResult {
  const blocks: string[] = [];
  const usedMemoryIds: number[] = [];

  const trimmed = originalPrompt.trim();
  const command = parseSkillCommand(trimmed);
  const activatedSkill = command
    ? input.skills.find((s) => s.name.toLowerCase() === command.skillName && s.enabled) ?? null
    : null;

  // 用户可见文本：去掉了 /技能名 前缀后的部分（保留参数）
  const visibleUserText = activatedSkill
    ? (command!.args.length > 0 ? command!.args : trimmed.replace(/^\/\S+\s*/, ''))
    : trimmed;

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
