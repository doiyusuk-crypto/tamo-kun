import express from "express";
import * as line from "@line/bot-sdk";
import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

// =========================
// 🔧 DEBUG設定
// =========================
const DEBUG = true;

// =========================
// 🧠 環境変数チェック
// =========================
if (!process.env.LINE_TOKEN) throw new Error("LINE_TOKEN is missing");
if (!process.env.LINE_SECRET) throw new Error("LINE_SECRET is missing");
if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

// ★ モデルを環境変数化
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

// =========================
// LINE設定
// =========================
const lineConfig = {
  channelAccessToken: process.env.LINE_TOKEN,
  channelSecret: process.env.LINE_SECRET,
};

const client = new line.Client(lineConfig);

// =========================
// Gemini設定
// =========================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: GEMINI_MODEL,
});

// =========================
// ログ
// =========================
function log(label, data) {
  console.log(`\n🔧 [${label}]`, data);
}

// =========================
// 重複防止（超重要）
// =========================
const processedMessages = new Set();

function isDuplicate(messageId) {
  if (processedMessages.has(messageId)) return true;
  processedMessages.add(messageId);

  // メモリ制御
  if (processedMessages.size > 100) {
    processedMessages.clear();
  }

  return false;
}

// =========================
// school.json
// =========================
function loadSchoolData() {
  try {
    return JSON.parse(fs.readFileSync("./school.json", "utf-8"));
  } catch (e) {
    console.error("❌ school.json error", e);
    return { events: [], notices: [], supplies: [] };
  }
}

// =========================
// intent分類
// =========================
function classifyIntent(text) {
  if (text.match(/持ち物|お道具箱|準備/)) return "supplies";
  if (text.match(/予定|行事|いつ|スケジュール/)) return "schedule";
  if (text.match(/お知らせ|連絡/)) return "notice";
  return "ai_fallback";
}

// =========================
// 検索
// =========================
function searchData(intent, text, school) {
  const results = [];

  if (intent === "schedule") {
    for (const e of school.events || []) {
      if (text.includes(e.title) || text.includes(e.date)) {
        results.push(e);
      }
    }
  }

  if (intent === "supplies") {
    for (const s of school.supplies || []) {
      results.push(s);
    }
  }

  if (intent === "notice") {
    for (const n of school.notices || []) {
      if (text.includes(n.title)) {
        results.push(n);
      }
    }
  }

  return results.slice(0, 5);
}

// =========================
// AI制限
// =========================
const lastAIUse = new Map();

function canUseAI(userId) {
  const now = Date.now();
  const last = lastAIUse.get(userId) || 0;

  if (now - last < 10000) return false;

  lastAIUse.set(userId, now);
  return true;
}

// =========================
// AI
// =========================
async function askAI(text, context) {
  const prompt = `
あなたは神戸市立多聞台小学校のコンシェルジュです。

以下の情報だけを使って回答してください。
情報がなければ「わかりません」と答えてください。

【参照情報】
${JSON.stringify(context, null, 2)}

【質問】
${text}
`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// =========================
// context生成
// =========================
function buildContext(text, school) {
  const context = [];

  if (text.includes("予定") || text.includes("いつ")) {
    context.push({ events: school.events?.slice(0, 5) });
  }

  if (text.includes("持ち物")) {
    context.push({ supplies: school.supplies?.slice(0, 5) });
  }

  if (context.length === 0) {
    context.push({
      events: school.events?.slice(0, 3),
      notices: school.notices?.slice(0, 3),
    });
  }

  return context;
}

// =========================
// Express
// =========================
const app = express();

app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  // ★ 先に返す（再送防止）
  res.sendStatus(200);

  try {
    const events = req.body.events;
    const school = loadSchoolData();

    log("EVENTS", events);

    for (const event of events) {
      if (event.type !== "message") continue;

      const messageId = event.message.id;
      const text = event.message.text;
      const userId = event.source.userId;

      log("MESSAGE_ID", messageId);

      // ★ 重複防止
      if (isDuplicate(messageId)) {
        console.log("⚠️ duplicate:", messageId);
        continue;
      }

      log("INPUT", text);

      const intent = classifyIntent(text);
      log("INTENT", intent);

      let replyText = "";

      // =========================
      // ルール処理
      // =========================
      if (intent !== "ai_fallback") {
        const results = searchData(intent, text, school);

        log("SEARCH_RESULTS", results);

        replyText =
          results.length > 0
            ? results.map(r => JSON.stringify(r)).join("\n")
            : "該当情報が見つかりませんでした。";
      }

      // =========================
      // AI fallback
      // =========================
      else {
        if (!canUseAI(userId)) {
          replyText = "少し待ってから試してね🙏";
        } else {
          const context = buildContext(text, school);
          log("AI_CONTEXT", context);

          try {
            replyText = await askAI(text, context);
          } catch (e) {
            console.error("AI ERROR", e);
            replyText = "AIが混雑中です🙏";
          }

          log("AI_RESPONSE", replyText);
        }
      }

      // =========================
      // DEBUG
      // =========================
      if (DEBUG) {
        replyText =
          `🧪 DEBUG\nmodel: ${GEMINI_MODEL}\nintent: ${intent}\ninput: ${text}\n---\n` +
          replyText;
      }

      await client.replyMessage(event.replyToken, {
        type: "text",
        text: replyText,
      });
    }
  } catch (err) {
    console.error("🔥 ERROR:", err);
  }
});

// =========================
// 起動
// =========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Bot running on port", PORT);
});
