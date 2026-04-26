import express from "express";
import * as line from "@line/bot-sdk";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

// =========================
// 🔧 環境変数チェック
// =========================
if (!process.env.LINE_TOKEN) throw new Error("LINE_TOKEN is missing");
if (!process.env.LINE_SECRET) throw new Error("LINE_SECRET is missing");
if (!process.env.RAG_API_URL) throw new Error("RAG_API_URL is missing");

// =========================
// 設定
// =========================
const DEBUG = true;
const PORT = process.env.PORT || 3000;

const lineConfig = {
  channelAccessToken: process.env.LINE_TOKEN,
  channelSecret: process.env.LINE_SECRET,
};

const client = new line.Client(lineConfig);

// =========================
// RAG API
// =========================
async function askRAG(question) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8秒でタイムアウト

  try {
    const res = await fetch(`${process.env.RAG_API_URL}/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question }),
      signal: controller.signal,
    });

    const data = await res.json();

    return data.answer || "回答が取得できませんでした";
  } catch (e) {
    console.error("❌ RAG API ERROR:", e);
    return "検索エラーが発生しました🙏";
  } finally {
    clearTimeout(timeout);
  }
}

// =========================
// 重複防止
// =========================
const processedMessages = new Set();

function isDuplicate(messageId) {
  if (processedMessages.has(messageId)) return true;
  processedMessages.add(messageId);

  if (processedMessages.size > 100) {
    processedMessages.clear();
  }

  return false;
}

// =========================
// レート制限
// =========================
const lastUse = new Map();

function canUse(userId) {
  const now = Date.now();
  const last = lastUse.get(userId) || 0;

  if (now - last < 5000) return false; // 5秒制限

  lastUse.set(userId, now);
  return true;
}

// =========================
// ログ
// =========================
function log(label, data) {
  console.log(`\n🔧 [${label}]`, data);
}

// =========================
// Express
// =========================
const app = express();

app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  // ★ 即レス（重要）
  res.sendStatus(200);

  try {
    const events = req.body.events;

    log("EVENTS", events);

    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message.type !== "text") continue;

      const messageId = event.message.id;
      const text = event.message.text;
      const userId = event.source.userId;

      // 重複防止
      if (isDuplicate(messageId)) {
        console.log("⚠️ duplicate:", messageId);
        continue;
      }

      log("INPUT", text);

      let replyText = "";

      // レート制限
      if (!canUse(userId)) {
        replyText = "少し待ってから試してね🙏";
      } else {
        // =========================
        // 🔥 RAG呼び出し（コア）
        // =========================
        replyText = await askRAG(text);
      }

      // =========================
      // DEBUG
      // =========================
      if (DEBUG) {
        replyText =
          `🧪 DEBUG\ninput: ${text}\n---\n` +
          replyText;
      }

      // =========================
      // 返信
      // =========================
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: replyText.slice(0, 5000), // LINE制限対策
      });
    }
  } catch (err) {
    console.error("🔥 ERROR:", err);
  }
});

// =========================
// 起動
// =========================
app.listen(PORT, () => {
  console.log("🚀 RAG LINE Bot running on port", PORT);
});
