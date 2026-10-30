import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BIN = path.join(PLUGIN_DIR, "bin", "handraw.mjs");

/**
 * 按宿主的调用方式跑一条命令：stdin 收 JSON，stdout 取最后一行 JSON。
 * 失败时命令会返回非 0 退出码（宿主会忽略退出码、按 state 判定），所以这里不用 execFileSync。
 */
function run(command, payload = {}) {
  const result = spawnSync(process.execPath, [BIN, command], {
    cwd: PLUGIN_DIR,
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 30000,
  });
  const lines = String(result.stdout || "").trim().split("\n").filter(Boolean);
  assert.ok(lines.length > 0, `命令没有输出任何内容：${command}\n${result.stderr}`);
  return JSON.parse(lines[lines.length - 1]);
}

const manifest = (name) => JSON.parse(readFileSync(path.join(PLUGIN_DIR, name), "utf8"));

test("doctor 报告风格库完整", () => {
  const data = run("doctor");
  assert.equal(data.state, "succeeded");
  assert.equal(data.ready, true);
  assert.equal(data.counts.styles, 366);
  assert.equal(data.counts.layouts, 167);
  assert.equal(data.counts.colors, 36);
  assert.equal(data.checks.styles.ok, true);
});

test("catalog meta 的分组数量与总数一致", () => {
  const data = run("catalog", { section: "meta" });
  assert.equal(data.state, "succeeded");
  const { groups, total } = data.meta;
  assert.equal(total, 366);
  assert.equal(groups.reduce((sum, group) => sum + group.count, 0), total);
  assert.equal(data.meta.layoutCategories.length, 5);
  assert.equal(data.meta.colorCategories.length, 6);
});

test("catalog styles 支持按分组与关键词过滤", () => {
  const byGroup = run("catalog", { section: "styles", group: "FA" });
  assert.equal(byGroup.styles.length, 40);
  assert.ok(byGroup.styles.every((item) => item.group === "FA"));

  const byKeyword = run("catalog", { section: "styles", q: "丰子恺" });
  assert.ok(byKeyword.styles.length > 0);
  assert.ok(byKeyword.styles.some((item) => item.reference.includes("丰子恺")));

  // v1.9.2 新增唐山皮影，分组计数必须同步
  const fe = run("catalog", { section: "styles", group: "FE" });
  assert.equal(fe.styles.length, 68);
  assert.ok(fe.styles.some((item) => item.code === "FE-068" && item.reference.includes("皮影")));
});

test("prompt 按模型名切换激活策略", () => {
  const base = { styleCode: "FA-001", theme: "吃冰淇淋的小姑娘" };
  assert.equal(run("prompt", { ...base, modelName: "gpt-image-2" }).prompt.strategy, "name-first");
  assert.equal(run("prompt", { ...base, modelName: "gemini-2.5-flash-image" }).prompt.strategy, "traits+reference");
  assert.equal(run("prompt", { ...base, modelName: "gpt-image-1" }).prompt.strategy, "traits-first");
  assert.equal(run("prompt", { ...base, modelName: "gemini-2.5-flash-image" }).prompt.useReferenceImage, true);
});

test("prompt 输出双语且包含编号、主题与模式约束", () => {
  const data = run("prompt", {
    styleCode: "FE-058",
    theme: "雨后在巷口下棋的两位老人",
    aspect: "4:3",
    mode: "text",
    layoutCode: "SC-001",
    colorCode: "C-01",
    modelName: "gpt-image-2",
  });
  const { prompt } = data;
  assert.match(prompt.zh, /编号 FE-058/);
  assert.match(prompt.zh, /主题：雨后在巷口下棋的两位老人/);
  assert.match(prompt.zh, /图文模式/);
  assert.match(prompt.zh, /画面比例 横向 4:3（4:3）/);
  assert.match(prompt.zh, /克莱因蓝/);
  assert.match(prompt.en, /Feng Zikai/);
  assert.match(prompt.en, /Aspect ratio 4:3/);
});

test("纯图模式 + 文字型版式时给出占位替代", () => {
  const { prompt } = run("prompt", { styleCode: "FA-001", theme: "咖啡店", layoutCode: "IG-001", mode: "pure" });
  assert.match(prompt.zh, /图形化的占位元素/);
});

test("非法编号返回 failed 而不是抛栈", () => {
  const missing = run("prompt", { styleCode: "FA-999", theme: "随便" });
  assert.equal(missing.state, "failed");
  assert.match(missing.error, /找不到风格编号/);

  const emptyTheme = run("prompt", { styleCode: "FA-001", theme: "   " });
  assert.equal(emptyTheme.state, "failed");
  assert.match(emptyTheme.error, /主题不能为空/);
});

test("清单文件结构可用", () => {
  const plugin = manifest("plugin.json");
  const ruodao = manifest("ruodao-plugin.json");
  const ui = manifest("ui.json");
  const submission = manifest("market-submission.json");

  assert.equal(plugin.name, "handraw-style");
  assert.equal(plugin.ui, "./ui.json");
  assert.equal(ruodao.id, "com.ruodao.handraw-style");
  assert.deepEqual(ruodao.contributes.commands.map((entry) => entry.id), [
    "com.ruodao.handraw.doctor",
    "com.ruodao.handraw.catalog",
    "com.ruodao.handraw.prompt",
  ]);
  for (const command of ruodao.contributes.commands) {
    assert.equal(command.action.type, "process");
    assert.equal(command.action.command, "node");
    assert.equal(command.action.cwd, ".");
  }
  assert.match(ui.route, /^[a-z0-9][a-z0-9-]+$/);
  assert.equal(ui.caseSharing.enabled, true);
  assert.deepEqual(ui.caseSharing.mediaTypes, ["image"]);
  assert.equal(submission.slug, "handraw-style");
  assert.equal(submission.version, plugin.version);
});
