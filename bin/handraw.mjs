#!/usr/bin/env node
/**
 * 手绘风画廊（Handraw Style）— 若道插件命令入口
 *
 * 命令（process.argv[2]）：
 *   doctor    自检：数据文件完整性、分组数量、参考图 CDN 基址
 *   catalog   风格库数据：stdin { section: "meta"|"styles"|"layouts"|"colors"|"all", group?, q?, limit? }
 *   prompt    组装提示词：stdin { styleCode, theme, layoutCode?, colorCode?, aspect?, mode?, modelName?, modelOrigin? }
 *
 * 约定：stdin 读 JSON（宿主注入 { mode, config, ...payload }），stdout 输出单行 JSON：
 *   { "state": "succeeded", ... } 或 { "state": "failed", "error": "...", "hint": "..." }
 *
 * 生成图片与案例分享不在这里做：桌面端工作台直接用宿主能力
 * （window.codex.generateImage / ruodaoUpload / ruodaoPluginCaseCreate），
 * 复用用户在「模型管理」里已配置好的模型，插件不保存任何密钥。
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, ASPECTS } from "../lib/prompt.mjs";

const PLUGIN_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(PLUGIN_DIR, "data");
const DEFAULT_IMAGE_BASE = "https://cdn.jsdelivr.net/gh/yang0/handraw-style@master";

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve({});
    let raw = "";
    const timer = setTimeout(() => resolve(safeParse(raw)), 3000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => { clearTimeout(timer); resolve(safeParse(raw)); });
    process.stdin.on("error", () => { clearTimeout(timer); resolve(safeParse(raw)); });
  });
}

function safeParse(raw) {
  const text = String(raw || "").trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

function ok(payload) {
  process.stdout.write(`${JSON.stringify({ state: "succeeded", ...payload })}\n`);
}

function fail(error, hint = "") {
  process.stdout.write(`${JSON.stringify({ state: "failed", error: String(error), ...(hint ? { hint } : {}) })}\n`);
  process.exitCode = 1;
}

/** 读取并缓存数据文件；单个文件损坏时返回 null 而不是崩溃 */
const cache = new Map();
function loadData(name) {
  if (cache.has(name)) return cache.get(name);
  const file = path.join(DATA_DIR, `${name}.json`);
  let value = null;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    value = null;
  }
  cache.set(name, value);
  return value;
}

function imageBase(config) {
  const raw = String(config?.RUODAO_HANDRAW_IMG_BASE ?? "").trim();
  return (raw || DEFAULT_IMAGE_BASE).replace(/\/+$/, "");
}

const clone = (value) => JSON.parse(JSON.stringify(value));

function commandDoctor(config) {
  const styles = loadData("styles");
  const layouts = loadData("layouts");
  const colors = loadData("colors");
  const files = ["styles", "layouts", "colors"].map((name) => {
    const file = path.join(DATA_DIR, `${name}.json`);
    const exists = existsSync(file);
    return { name, file, exists, bytes: exists ? statSync(file).size : 0 };
  });
  const totalStyles = styles?.total ?? styles?.styles?.length ?? 0;
  const declared = (styles?.groups || []).reduce((sum, group) => sum + Number(group.count || 0), 0);
  const checks = {
    dataFiles: { ok: files.every((entry) => entry.exists && entry.bytes > 1024), detail: files.map((entry) => `${entry.name}:${entry.exists ? `${Math.round(entry.bytes / 1024)}KB` : "缺失"}`).join(" · ") },
    styles: { ok: totalStyles > 0 && declared === totalStyles, detail: `${totalStyles} 种风格，分组声明合计 ${declared}` },
    layouts: { ok: (layouts?.layouts?.length ?? 0) > 0, detail: `${layouts?.layouts?.length ?? 0} 种排版图型` },
    colors: { ok: (colors?.colors?.length ?? 0) > 0, detail: `${colors?.colors?.length ?? 0} 种经典单色` },
  };
  return {
    checks,
    upstream: styles?.upstream || null,
    counts: { styles: totalStyles, layouts: layouts?.layouts?.length ?? 0, colors: colors?.colors?.length ?? 0 },
    imageBase: imageBase(config),
    aspects: ASPECTS,
    ready: Object.values(checks).every((check) => check.ok),
  };
}

function commandCatalog(payload) {
  const section = String(payload?.section || "all").toLowerCase();
  const group = String(payload?.group || "").trim().toUpperCase();
  const keyword = String(payload?.q || "").trim().toLowerCase();
  const limit = Math.min(Math.max(Number(payload?.limit || 0) || 0, 0), 400);

  const out = { section, imageBase: imageBase(payload?.config) };

  if (section === "meta" || section === "all") {
    const styles = loadData("styles");
    out.meta = {
      upstream: styles?.upstream || null,
      total: styles?.total ?? styles?.styles?.length ?? 0,
      groups: styles?.groups || [],
      layoutCategories: loadData("layouts")?.categories || [],
      colorCategories: loadData("colors")?.categories || [],
      aspectSource: "host",
    };
  }

  if (section === "styles" || section === "all") {
    let items = clone(loadData("styles")?.styles || []);
    if (group && group !== "ALL") items = items.filter((item) => item.group === group);
    if (keyword) items = items.filter((item) => [item.code, item.name, item.reference, item.traits].join(" ").toLowerCase().includes(keyword));
    if (limit) items = items.slice(0, limit);
    out.styles = items;
    out.total = items.length;
  }

  if (section === "layouts" || section === "all") {
    const data = loadData("layouts");
    let items = clone(data?.layouts || []);
    if (keyword) items = items.filter((item) => [item.code, item.nameZh, item.nameEn, item.promptZh].join(" ").toLowerCase().includes(keyword));
    if (limit) items = items.slice(0, limit);
    out.layouts = items;
    out.layoutCategories = data?.categories || [];
    out.layoutTotal = items.length;
  }

  if (section === "colors" || section === "all") {
    const data = loadData("colors");
    let items = clone(data?.colors || []);
    if (keyword) items = items.filter((item) => [item.code, item.nameZh, item.nameEn].join(" ").toLowerCase().includes(keyword));
    if (limit) items = items.slice(0, limit);
    out.colors = items;
    out.colorCategories = data?.categories || [];
    out.colorTotal = items.length;
  }

  return out;
}

function commandPrompt(payload) {
  const code = String(payload?.styleCode || "").trim().toUpperCase();
  if (!code) throw new Error("缺少 styleCode");
  const styles = loadData("styles")?.styles || [];
  const style = styles.find((item) => item.code === code);
  if (!style) throw new Error(`找不到风格编号：${code}`);
  const layoutCode = String(payload?.layoutCode || "").trim().toUpperCase();
  const colorCode = String(payload?.colorCode || "").trim().toUpperCase();
  const layout = layoutCode ? (loadData("layouts")?.layouts || []).find((item) => item.code === layoutCode) || null : null;
  const color = colorCode ? (loadData("colors")?.colors || []).find((item) => item.code === colorCode) || null : null;
  if (layoutCode && !layout) throw new Error(`找不到图型编号：${layoutCode}`);
  if (colorCode && !color) throw new Error(`找不到颜色编号：${colorCode}`);

  const prompt = buildPrompt({
    style,
    layout,
    color,
    theme: payload?.theme,
    aspect: String(payload?.aspect || "1:1"),
    mode: payload?.mode === "text" ? "text" : "pure",
    modelName: String(payload?.modelName || ""),
    modelOrigin: String(payload?.modelOrigin || ""),
  });
  return { prompt, style: { code: style.code, name: style.name, reference: style.reference, image: style.image } };
}

async function main() {
  const command = String(process.argv[2] || "").trim().toLowerCase();
  const payload = await readStdin();
  const config = payload?.config && typeof payload.config === "object" ? payload.config : {};

  try {
    if (!command || command === "help" || command === "--help") {
      return ok({ commands: ["doctor", "catalog", "prompt"], usage: "node bin/handraw.mjs <command>  (JSON payload via stdin)" });
    }
    if (command === "doctor") return ok(commandDoctor(config));
    if (command === "catalog") return ok(commandCatalog({ ...payload, config }));
    if (command === "prompt") return ok(commandPrompt({ ...payload, config }));
    return fail(`未知命令：${command}`, "可用命令：doctor / catalog / prompt");
  } catch (error) {
    return fail(error?.message || String(error), "检查 stdin 是否传入合法 JSON，以及编号是否存在");
  }
}

void main();
