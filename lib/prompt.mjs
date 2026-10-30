/**
 * lib/prompt.mjs — 手绘风提示词组装（若道插件版）
 *
 * 与 WorkBuddy 版共用同一套规则，区别在于「模型策略」由宿主传入的模型名推断：
 *   宿主模型来自桌面端「模型管理」，插件不自己存密钥。
 */

const ASPECT_LABEL = {
  "1:1": "正方形",
  "4:3": "横向 4:3",
  "3:4": "纵向 3:4",
  "16:9": "宽屏 16:9",
  "9:16": "竖屏 9:16",
  "3:2": "横向 3:2",
  "2:3": "纵向 2:3",
};

const CJK_RE = /[\u3400-\u9fff]/;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/**
 * 按宿主模型名推断激活策略。
 * - name-first：官方深度适配过「作者名 + 风格名」的模型（gpt-image-2 系）
 * - traits+reference：支持参考图输入的多模态模型
 * - traits-first：其余模型，靠中文核心特征词激活
 */
export function resolveStrategy(modelName = "", modelOrigin = "") {
  const name = `${modelName} ${modelOrigin}`.toLowerCase();
  if (/gpt-image-2/.test(name)) return { strategy: "name-first", useReferenceImage: false };
  if (/(gemini|imagen|nano.?banana|flux|qwen-image|seedream)/.test(name)) return { strategy: "traits+reference", useReferenceImage: true };
  return { strategy: "traits-first", useReferenceImage: false };
}

function modeZh(mode) {
  return mode === "text"
    ? "图文模式：保留主题原文作为画面中的文字，让文字参与构图，文字与插图一体化设计，主标题清晰有分量，小字尽量少。"
    : "纯图模式：画面内不要出现任何文字、字母、数字或水印，主题只决定画面内容。";
}

function modeEn(mode) {
  return mode === "text"
    ? "Graphic-text mode: keep the theme wording as visible typography inside the composition, integrate type and illustration as one design, with a confident main title and minimal secondary text."
    : "Image-only mode: no text, letters, numbers or watermarks anywhere in the picture; the theme only determines the visual subject.";
}

/**
 * @param {object} ctx
 * @param {object} ctx.style    风格条目
 * @param {object=} ctx.layout  版式条目
 * @param {object=} ctx.color   单色条目
 * @param {string} ctx.theme    主题
 * @param {string=} ctx.aspect  画面比例，默认 1:1
 * @param {"pure"|"text"=} ctx.mode 渲染模式
 * @param {string=} ctx.modelName 宿主模型名，用于推断策略
 * @param {string=} ctx.modelOrigin
 */
export function buildPrompt(ctx) {
  const { style, layout, color, theme, aspect = "1:1", mode = "pure", modelName = "", modelOrigin = "" } = ctx || {};
  if (!style) throw new Error("缺少风格条目，无法组装提示词");
  if (!clean(theme)) throw new Error("主题不能为空");

  const { strategy, useReferenceImage } = resolveStrategy(modelName, modelOrigin);
  const textHeavyLayout = ["social-card", "infographic", "ecommerce"].includes(layout?.category);
  const ratioZh = ASPECT_LABEL[aspect] || aspect;

  const zh = [];
  zh.push(`风格：${style.name}${style.reference ? `（致敬 ${style.reference}）` : ""}｜编号 ${style.code}。`);
  if (style.traits) zh.push(`${strategy === "name-first" ? "风格补充特征" : "核心风格特征"}：${clean(style.traits)}`);
  zh.push(`主题：${clean(theme)}。`);
  if (layout?.promptZh) zh.push(`版式图型（${layout.code} ${layout.nameZh}）：${clean(layout.promptZh)}`);
  if (color?.promptZh) zh.push(clean(color.promptZh));
  zh.push(modeZh(mode));
  if (mode === "pure" && textHeavyLayout) zh.push("版式中预留的文字区域请用图形化的占位元素（色块、线条、留白）代替，不要写出真实文字。");
  zh.push(`画面比例 ${ratioZh}（${aspect}）。`);
  if (useReferenceImage) zh.push("请参考随附的风格参考图，严格保持其线条质感、上色方式与配色倾向，不要照搬参考图的具体内容。");

  const en = [];
  en.push(`Style: ${style.name}${style.reference ? `, in the spirit of ${style.reference}` : ""} (${style.code}).`);
  if (style.traits) en.push(`Core visual traits (original Chinese reference, keep them faithfully): ${clean(style.traits)}`);
  en.push(CJK_RE.test(theme) ? `Theme (verbatim, Chinese): 「${clean(theme)}」.` : `Theme: ${clean(theme)}.`);
  if (layout?.promptEn) en.push(`Layout (${layout.code} ${layout.nameEn}): ${clean(layout.promptEn)}`);
  if (color?.promptEn) en.push(clean(color.promptEn));
  en.push(modeEn(mode));
  if (mode === "pure" && textHeavyLayout) en.push("Replace any text zone required by the layout with graphic placeholders (blocks, rules, whitespace) instead of real words.");
  en.push(`Aspect ratio ${aspect}.`);
  if (useReferenceImage) en.push("Use the attached style reference for line quality, colouring and palette only; do not copy its subject matter.");

  return {
    strategy,
    useReferenceImage,
    styleCode: style.code,
    aspect,
    mode,
    zh: zh.join("\n"),
    en: en.join("\n"),
    oneLine: { zh: zh.join(" "), en: en.join(" ") },
  };
}

export const ASPECTS = Object.keys(ASPECT_LABEL);
