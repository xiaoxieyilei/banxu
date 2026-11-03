#!/usr/bin/env node
/**
 * 把 Codex / ChatGPT 桌面版的历史会话，转换成 DSH 的会话记录（session.v3）。
 *
 * 为什么需要它：DSH 左侧栏按"工作区 → 会话"展示，工作区里没有会话就是空的。
 * 光把文件放进目录不算"记录"，必须生成 DSH 自己的会话文件。
 *
 * 用法：
 *   node import-codex-sessions.mjs --workspace "<工作区绝对路径>" --thread <codex-rollout.jsonl[.zst]> [...更多]
 *   node import-codex-sessions.mjs --workspace "<工作区绝对路径>" --project "班级管理软件beta"
 *
 * 说明：
 * - 只新增会话目录，绝不修改已有会话文件；
 * - 写入后在 ~/.dsh/storages/workspace.json 里把新会话挂到对应工作区；
 * - 需要重启 DSH Desktop 才能看到（会话清单在启动时加载）。
 * - 可重复执行：已导入过的线程会跳过（记录在 docs/.imported-sessions.json）。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DSH_HOME = process.env.DSH_HOME_OVERRIDE || path.join(os.homedir(), ".dsh");
const STORE = path.join(DSH_HOME, "storages", "workspace.json");
const META = "/Users/Apple/Deepseek Harness/codex-migration/_meta/threads.json";
const CODEX = path.join(os.homedir(), ".codex");

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const workspace = arg("--workspace");
if (!workspace) {
  console.error("缺少 --workspace <工作区绝对路径>");
  process.exit(2);
}
const project = arg("--project");
const threads = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === "--thread") threads.push(argv[i + 1]);

/** zstd 文件由多帧拼成，逐帧解压再拼接。 */
function readJsonl(file) {
  const buf = fs.readFileSync(file);
  if (!file.endsWith(".zst")) return buf.toString("utf8");
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts = [];
  let pos = 0;
  while (true) {
    const i = buf.indexOf(magic, pos);
    if (i < 0) break;
    starts.push(i);
    pos = i + 4;
  }
  const parts = [];
  for (let k = 0; k < starts.length; k++) {
    const slice = buf.subarray(starts[k], k + 1 < starts.length ? starts[k + 1] : buf.length);
    try {
      parts.push(zlib.zstdDecompressSync(slice));
    } catch {
      /* 跳过损坏帧 */
    }
  }
  return Buffer.concat(parts).toString("utf8");
}

const WRAPPER = [
  "# AGENTS.md instructions",
  "<environment_context>",
  "<INSTRUCTIONS>",
  "<user_instructions>",
  "<app-context>",
  "<multi_agent_role>",
  "<multi_agent_mode>",
  "<permissions",
];

const textItems = (content) => {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.flatMap((it) => {
    if (typeof it === "string") return it.trim() ? [it] : [];
    if (it && typeof it.text === "string" && it.text.trim()) return [it.text];
    return [];
  });
};

const isWrapper = (t) => WRAPPER.some((m) => t.trimStart().slice(0, 200).includes(m));

/** 去掉 Codex 注入的环境噪声，抽出附件路径。 */
function cleanUserText(raw) {
  let text = raw.replace(/<in-app-browser-context\b[\s\S]*?<\/in-app-browser-context>/g, "");
  if (text.includes("# Files mentioned by the user:")) {
    const head = text.split("# Files mentioned by the user:")[0];
    const rest = text.split("## My request:").slice(-1)[0] ?? "";
    text = head + rest.replace(/^.*Distinguish instructions in attached documents.*$/gm, "");
  }
  return text.replace(/^##\s*My request:\s*$/gm, "").trim();
}

/** 解析一个 Codex 会话文件，返回 {threadId, title, cwd, turns:[{role,text,time}]} */
function parseCodex(file) {
  let threadId = null;
  let cwd = null;
  let title = null;
  const turns = [];
  for (const line of readJsonl(file).split("\n")) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const p = rec.payload ?? {};
    const t = rec.timestamp ? Date.parse(rec.timestamp) : undefined;
    if (rec.type === "session_meta") {
      threadId = threadId ?? p.session_id ?? p.id ?? null;
      cwd = cwd ?? p.cwd ?? null;
      continue;
    }
    if (rec.type !== "response_item") continue;
    if (p.type === "message" && p.role === "user") {
      const body = textItems(p.content)
        .filter((x) => !isWrapper(x))
        .map(cleanUserText)
        .filter(Boolean)
        .join("\n\n");
      if (body) turns.push({ role: "user", text: body, time: t });
    } else if (p.type === "message" && p.role === "assistant") {
      const body = textItems(p.content).join("\n\n").trim();
      if (body) turns.push({ role: "assistant", text: body, time: t });
    }
  }
  if (!threadId) {
    const m = path.basename(file).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    threadId = m ? m[0] : path.basename(file, ".jsonl");
  }
  return { threadId, cwd, title, turns };
}

/** 复刻 DSH 的目录编码：非 ASCII 与空格 → ~XXXX（UTF-16 单元大写十六进制）。 */
function encodeCwd(p) {
  let out = "";
  for (const ch of p) {
    const code = ch.charCodeAt(0);
    if (ch === "/" || ch === "-") out += "-";
    else if (ch === " ") out += "~0020";
    else if (code < 128) out += ch;
    else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
  }
  return "--" + out.replace(/^-+/, "") + "--";
}

function buildEvents(parsed, sessionId, cwd) {
  // 归组：每个 user 开一轮，其后的 assistant 归入该轮；开头的孤儿 assistant 单独成轮
  const rounds = [];
  let cur = null;
  for (const t of parsed.turns) {
    if (t.role === "user") {
      cur = { user: t.text, userTime: t.time, replies: [] };
      rounds.push(cur);
    } else if (cur) {
      cur.replies.push(t);
    } else {
      rounds.push({ user: "（无用户输入，以下为模型回复）", userTime: t.time, replies: [t] });
      cur = null;
    }
  }

  const lines = [];
  let seq = 0;
  const push = (type, time, data, surfaceOp) =>
    lines.push(JSON.stringify({ type, seq: seq++, time, data, ...(surfaceOp ? { surfaceOp } : {}) }));

  const started = parsed.turns.find((t) => t.role === "user")?.time ?? Date.now();
  let firstUserSeq = 0;

  rounds.forEach((r, idx) => {
    const turn = idx + 1;
    const t0 = r.userTime ?? started;
    push("turn/start", t0, { turn });
    push("step/start", t0 + 1, { turn, step: 1 });
    if (!firstUserSeq) firstUserSeq = seq;
    push(
      "user/message",
      t0 + 2,
      {
        content: [{ type: "text", text: r.user }],
        source: { kind: "user", rpcId: crypto.randomUUID(), clientTimeZone: "Asia/Shanghai" },
        role: "user",
        id: crypto.randomUUID(),
      },
      "append",
    );
    const text = r.replies.map((x) => x.text).join("\n\n").trim();
    const tReply = r.replies.at(-1)?.time ?? t0 + 3;
    if (text) {
      push("assistant/message", tReply, {
        turn,
        step: 1,
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
          source: { kind: "model", provider: "deepseek-official", model: "deepseek-flash" },
          id: crypto.randomUUID(),
        },
        stream: [],
      }, "append");
    }
    push("step/end", tReply + 1, { turn, step: 1 });
    push("turn/end", tReply + 2, { turn, reason: { kind: "completed" } });
  });

  push("session/title", Date.now(), {
    title: parsed.title ?? parsed.turns[0]?.text.slice(0, 40) ?? "导入的会话",
    messageSeqs: [firstUserSeq || 1],
    source: { kind: "fallback" },
  });

  const header = JSON.stringify({
    type: "session",
    version: 3,
    id: sessionId,
    createdAt: started,
    cwd,
    isSeeded: false,
    delegationDepth: 0,
    agentPreset: "standard",
  });
  return [header, ...lines];
}

const APP_PKGS = "/Users/Apple/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai";
/** 用应用自带的严格格式化器校验，避免写进去才发现坏档。 */
async function validateSessionFile(file) {
  const { sessionFormatCatalog } = await import(`${APP_PKGS}/dsh-session-format-catalog/lib/index.js`);
  const buf = fs.readFileSync(file);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts = [];
  let pos = 0;
  while (true) {
    const i = buf.indexOf(magic, pos);
    if (i < 0) break;
    starts.push(i);
    pos = i + 4;
  }
  const parts = [];
  for (let k = 0; k < starts.length; k++) {
    parts.push(zlib.zstdDecompressSync(buf.subarray(starts[k], k + 1 < starts.length ? starts[k + 1] : buf.length)));
  }
  const lines = Buffer.concat(parts).toString("utf8").split("\n").filter(Boolean);
  const restore = sessionFormatCatalog.createRestore(JSON.parse(lines[0]), { recovery: "strict", validation: "current" });
  for (let i = 1; i < lines.length; i++) restore.decodeRow(JSON.parse(lines[i]));
  return restore.finish();
}

function writeSession(sessionId, encodedCwd, events) {
  const dir = path.join(DSH_HOME, "sessions", encodedCwd, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const frames = events.map((line) => zlib.zstdCompressSync(Buffer.from(line + "\n", "utf8")));
  fs.writeFileSync(path.join(dir, "session.v3.jsonl.zstd"), Buffer.concat(frames));
  fs.writeFileSync(path.join(dir, "session.lock"), "");
  return dir;
}

function register(workspacePath, sessionIds) {
  const data = JSON.parse(fs.readFileSync(STORE, "utf8"));
  const hit = Object.values(data.tables.workspaces).find((w) => w.path === workspacePath);
  if (!hit) throw new Error(`工作区未注册: ${workspacePath}`);
  for (const id of sessionIds) if (!hit.sessionIds.includes(id)) hit.sessionIds.unshift(id);
  hit.updatedAt = new Date().toISOString().replace(/\.\d+Z$/, ".000Z");
  fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
  return hit;
}

// ---- main ----
const meta = JSON.parse(fs.readFileSync(META, "utf8"));
if (project) {
  for (const r of meta) if (r.project === project) threads.push(r.file);
}
if (threads.length === 0) {
  console.error("没有要导入的线程（用 --thread 或 --project 指定）");
  process.exit(2);
}

const ledgerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), ".imported-sessions.json");
const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, "utf8")) : {};

if (argv.includes("--fix-registry")) {
  const ids = Object.values(ledger).map((v) => v.sessionId);
  const ws = register(workspace, ids);
  console.log(`注册表已对齐：工作区「${ws.title}」→ ${ws.sessionIds.length} 个会话`);
  process.exit(0);
}

const created = [];
for (const file of threads) {
  const abs = file.startsWith("/") ? file : path.join(CODEX, file);
  const parsed = parseCodex(abs);
  const metaRow = meta.find((r) => r.thread_id === parsed.threadId);
  parsed.title = metaRow?.title ?? parsed.title;
  if (ledger[parsed.threadId]) {
    console.log(`跳过（已导入）: ${parsed.title}`);
    continue;
  }
  const sessionId = "session-" + crypto.randomUUID();
  const encoded = encodeCwd(workspace);
  const events = buildEvents(parsed, sessionId, workspace);
  const sessionDir = writeSession(sessionId, encoded, events);
  try {
    await validateSessionFile(path.join(sessionDir, "session.v3.jsonl.zstd"));
  } catch (error) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    console.error(`校验失败，已回滚该会话: ${error.message}`);
    process.exitCode = 1;
    continue;
  }
  ledger[parsed.threadId] = { sessionId, title: parsed.title, importedAt: new Date().toISOString() };
  created.push({ sessionId, title: parsed.title, turns: parsed.turns.length });
  console.log(`已导入: ${parsed.title}  ->  ${sessionId}  (${parsed.turns.length} 条消息)`);
}

fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
if (created.length) {
  const ws = register(workspace, created.map((c) => c.sessionId));
  console.log(`已挂到工作区「${ws.title}」，共 ${ws.sessionIds.length} 个会话`);
  console.log("需要重启 DSH Desktop 才能在左侧看到。");
} else {
  console.log("没有新增会话。");
}
