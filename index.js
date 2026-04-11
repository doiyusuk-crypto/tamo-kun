import express from "express";
import line from "@line/bot-sdk";
import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();

// ===== LINE設定 =====
const lineConfig = {
  channelAccessToken: process.env.LINE_TOKEN,
  channelSecret: process.env.LINE_SECRET,
};

const client = new line.Client(lineConfig);

// ===== Gemini設定 =====
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// ===== データ読み込み =====
function loadSchoolData() {
  return JSON.parse(fs.readFileSync("./school.json", "utf-8"));
}

// ===== intent分類（軽量・トークン0）=====
function classifyIntent(text) {
  if (text.match(/持ち物|お道具箱|準備/)) return "supplies";
  if (text.match(/予定|行事|いつ|スケジュール/)) return "schedule";
  if (text.match(/お知らせ|連絡/)) return "notice";
  return "ai_fallback";
}

// ===== データ検索 =====
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
      if (text.includes(s) || true) {
        results.push(s);
      }
    }
  }

  if (intent === "notice") {
    for (const n of school.notices || []) {
      if (text.includes(n.title)) {
        results.push(n);
      }
    }
  }

  return results.slice(0, 5); // トークン節約の核心
}

// ===== AI fallback =====
async function askAI(text, context) {
  const prompt = `
あなたは「神戸市立多聞台小学校の案内コンシェルジュ」です。

以下の情報だけを使って答えてください。
情報がない場合は「わかりません」と答えてください。

【参照情報】
${JSON.stringify(context, null, 2)}

【質問】
${text}
`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ===== メイン処理 =====
app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    const school = loadSchoolData();

    for (const event of events) {
      if (event.type !== "message") continue;

      const text = event.message.text;

      // ① intent判定
      const intent = classifyIntent(text);

      let replyText = "";

      // ② ルールで処理
      if (intent !== "ai_fallback") {
        const results = searchData(intent, text, school);

        if (results.length > 0) {
          replyText =
            "📘 見つかった情報です\n\n" +
            results.map(r => JSON.stringify(r)).join("\n");
        } else {
          replyText = "該当情報が見つかりませんでした。";
        }
      }

      // ③ AI fallback
      else {
        const context = buildContext(text, school);
        replyText = await askAI(text, context);
      }

      await client.replyMessage(event.replyToken, {
        type: "text",
        text: replyText,
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ===== AI用コンテキスト生成（超重要）=====
function buildContext(text, school) {
  const context = [];

  // 必要最小限だけ渡す（トークン節約の核）
  if (text.includes("予定") || text.includes("いつ")) {
    context.push({ events: school.events?.slice(0, 5) });
  }

  if (text.includes("持ち物")) {
    context.push({ supplies: school.supplies?.slice(0, 5) });
  }

  if (text.includes("お知らせ")) {
    context.push({ notices: school.notices?.slice(0, 5) });
  }

  // fallback（曖昧時は少し広め）
  if (context.length === 0) {
    context.push({
      events: school.events?.slice(0, 3),
      notices: school.notices?.slice(0, 3),
    });
  }

  return context;
}

// ===== 起動 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Bot running on port", PORT);
});
