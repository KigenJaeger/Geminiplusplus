// 从模型回复里识别 SKILL.md 草稿。
//
// 难点在于：我们拿到的不是模型输出的原始 Markdown，而是 Gemini 渲染后的 innerText，
// 渲染过程会吃掉信息：
//
// 1. 代码块外的 `---` 被渲染成 <hr>，innerText 里那两行横线直接消失，frontmatter 的
//    分隔符没了。这是"调用了 skill-creator 但没出现导入按钮"最主要的原因——模型没把
//    SKILL.md 包进代码块时必然发生。
// 2. 代码块里的 ``` 围栏本身不进 innerText，所以"先找围栏"这一步在渲染文本上永远失配。
// 3. 回复里可能有多个代码块（示例、片段），第一个不一定是 SKILL.md。
//
// 所以这里做的是「多候选 + 宽松兜底」：每个候选区域先按严格 frontmatter 试，
// 再按"开头连续的 key: value"试，取解析结果最完整的一个。
//
// 纯函数，无 DOM 无 chrome，可以在 node 环境下测。

import type { NewSkill } from '../types';
import { isMemorySkill } from './memory';

/** frontmatter 里认识的键 */
const KNOWN_KEYS = new Set(['name', 'description', 'version', 'author', 'license', 'tags', 'model']);

/** 宽松模式下，name 必须出现在前几行，避免把正文里的 "Note:" 当成 frontmatter */
const LOOSE_NAME_MAX_LINE = 5;

function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function stripQuotes(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, '');
}

/** 解析 key: value 块 */
function parseMeta(block: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const item = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (item) meta[item[1]!.toLowerCase()] = stripQuotes(item[2]!);
  }
  return meta;
}

function build(meta: Record<string, string>, instructions: string): NewSkill | null {
  const name = normalizeName(meta.name ?? '');
  const body = instructions.trim();
  if (!name || !body) return null;
  const description = (meta.description ?? '').slice(0, 500);
  return {
    name,
    description,
    instructions: body,
    memoryEnabled: false,
    memoryWriteEnabled: isMemorySkill({ name, description, instructions: body }),
  };
}

/** 严格模式：--- frontmatter --- 正文。收尾的 --- 后面可以没有换行。 */
function parseStrict(source: string): NewSkill | null {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/m.exec(source.trim());
  if (!match) return null;
  return build(parseMeta(match[1]!), match[2] ?? '');
}

/** 这一行是不是 key: value 形状 */
function keyValue(line: string): { key: string; value: string } | null {
  const item = /^[ \t]*([A-Za-z][\w-]*)[ \t]*:[ \t]*(.*)$/.exec(line);
  if (!item) return null;
  return { key: item[1]!.toLowerCase(), value: stripQuotes(item[2]!) };
}

/**
 * 宽松模式：`---` 已经被渲染成 <hr> 冲掉了，只剩一段连续的 key: value。
 *
 * 做法是先定位 name: 那一行，再向上向下把连续的已知键收进来。不能假设 frontmatter
 * 从第 0 行开始——模型通常会先写一句"这是给你的草稿"，那句话在 innerText 里就在前面。
 *
 * 防误判的三道闸：name 必须在靠前的位置、至少要有两个已知键、块的上一行不能是
 * 别的 key: value（那更像在罗列数据，不是 frontmatter）。
 */
function parseLoose(source: string): NewSkill | null {
  const lines = source.trim().split(/\r?\n/);

  let nameLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const item = keyValue(lines[i]!);
    if (item?.key === 'name' && normalizeName(item.value)) {
      nameLine = i;
      break;
    }
  }
  if (nameLine < 0 || nameLine > LOOSE_NAME_MAX_LINE) return null;

  let start = nameLine;
  while (start > 0) {
    const item = keyValue(lines[start - 1]!);
    if (!item || !KNOWN_KEYS.has(item.key)) break;
    start -= 1;
  }

  let end = nameLine + 1;
  while (end < lines.length) {
    const line = lines[end]!;
    if (!line.trim()) {
      end += 1;
      continue;
    }
    const item = keyValue(line);
    if (!item || !KNOWN_KEYS.has(item.key)) break;
    end += 1;
  }

  // 块正上方还是 key: value，说明这是一片罗列，不是 frontmatter
  if (start > 0 && keyValue(lines[start - 1]!)) return null;

  const meta: Record<string, string> = {};
  for (const line of lines.slice(start, end)) {
    const item = keyValue(line);
    if (item && KNOWN_KEYS.has(item.key)) meta[item.key] = item.value;
  }
  if (Object.keys(meta).length < 2) return null;

  return build(meta, lines.slice(end).join('\n'));
}

/**
 * 围栏代码块的内容。围栏用 3 个以上反引号或波浪号；
 * 语言标记不限（模型会写 markdown / md / yaml / text，也可能不写）。
 */
function fencedBlocks(raw: string): string[] {
  const found: string[] = [];
  const fence = /^[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm;
  for (const match of raw.matchAll(fence)) {
    const body = match[2];
    if (body?.trim()) found.push(body);
  }
  return found;
}

/**
 * 从模型回复文本里识别 SKILL.md 草稿，识别不到返回 null（不抛错）。
 *
 * @param raw 回复文本，可以是原始 Markdown 也可以是渲染后的 innerText
 * @param options.trusted 用户刚用过 /skill-creator。此时误判代价低、漏判代价高，
 *   所以放开宽松模式；否则只在文本里出现 skill 字样时才启用宽松模式。
 */
export function detectSkillDraft(raw: string, options: { trusted?: boolean } = {}): NewSkill | null {
  if (!raw.trim()) return null;
  // 没有任何 key: value 的形状，直接不用往下走
  if (!/^[ \t]*[A-Za-z][\w-]*[ \t]*:/m.test(raw)) return null;

  const allowLoose = options.trusted === true || /skill/i.test(raw);

  const parse = (source: string): NewSkill | null =>
    parseStrict(source) ?? (allowLoose ? parseLoose(source) : null);

  // 先在围栏块里找。围栏是模型给出正式草稿的标准形态，块内文本干净、没有前后的说明话术。
  const fenced = fencedBlocks(raw).map(parse).filter((item): item is NewSkill => item !== null);
  if (fenced.length > 0) {
    // 多个块时取正文最长的：示例片段会输给完整的那份
    return fenced.reduce((best, item) => (item.instructions.length > best.instructions.length ? item : best));
  }

  // 围栏里没有才退回整段文本。顺序不能反——拿整段去解析会把围栏后面的说明话术
  // 一起吞进 instructions，而且因为更长会在"取最长"里赢过块内那份干净的结果。
  return parse(raw);
}
