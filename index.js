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

@app.route("/ask", methods=["POST"])
def ask():
    try:
        query = request.json.get("query", "")

        docs = load_data()
        hits = search_docs(query, docs)

        if not hits:
            return jsonify({"answer": "該当する情報が見つかりませんでした。"})

        # 🔥 安定化
        hits = hits[:3]
        context = "\n".join([d["content"][:300] for d in hits])

        prompt = f"""
以下の情報だけを使って答えてください。

{context}

質問: {query}
"""

        try:
            answer = call_gemini(prompt)
        except Exception as e:
            print("Gemini error:", e)
            return jsonify({"answer": "AI生成でエラーが発生しました"})

        return jsonify({
            "answer": answer,
            "sources": hits
        })

    except Exception as e:
        print("RAG ERROR:", e)
        return jsonify({"status": "error", "message": str(e)})


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
