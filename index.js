import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import fetch from "node-fetch";
import fs from "fs";

const app = express();

// ===== 環境変数 =====
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const client = new Client(config);

// ===== JSON読み込み =====
const SCHOOL_DATA = JSON.parse(
  fs.readFileSync("./school.json", "utf-8")
);

// ===== AI管理 =====
let aiUsageCount = 0;
const AI_LIMIT = 15;

// ===== Persona（Wisut風）=====
const PERSONA = `
あなたはやさしくて少し不思議な雰囲気の小学校サポートAIです。

・短い言葉
・やさしい
・説明しすぎない
・改行を使う
・少し余白

口調：
「〜だよ」
「〜かもね」
「いいね」
`;

// ===== ユーティリティ =====
function getTodayWeekday() {
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[new Date().getDay()];
}

// ===== キャラフィルター =====
function wisut(text) {
  if (!text) return "";

  const endings = [
    "いいね",
    "だいじょうぶ",
    "ゆっくりでいいよ",
    "たぶん大丈夫",
    "気をつけてね"
  ];

  const end = endings[Math.floor(Math.random() * endings.length)];

  return `${text}\n\n${end}`;
}

// ===== ルール応答 =====
function ruleBasedResponse(userMessage, weekday) {

  // 下校
  if (userMessage.includes("下校") || userMessage.includes("帰り")) {
    const gradeMatch = userMessage.match(/[1-6]/);
    const grade = gradeMatch ? gradeMatch[0] : null;

    if (!grade) return "何年生か教えてね";

    const time =
      SCHOOL_DATA.time_rules.dismissal_matrix[weekday]?.[grade];

    return `${grade}年生は\n${time} くらい`;
  }

  // 持ち物
  if (
    userMessage.includes("持ち物") ||
    userMessage.includes("準備")
  ) {
    const items = [
      ...SCHOOL_DATA.items.daily,
      ...(SCHOOL_DATA.items.weekly[weekday] || []),
      ...SCHOOL_DATA.items.lunch.required
    ];

    return `今日の持ち物\n\n${items.join("\n")}`;
  }

  // 登校
  if (userMessage.includes("登校")) {
    const { start, end } = SCHOOL_DATA.time_rules.arrival;
    return `登校は\n${start}〜${end}`;
  }

  return null;
}

// ===== AI呼び出し =====
async function callAI(userMessage) {
  if (aiUsageCount >= AI_LIMIT) {
    console.log("AI制限到達");
    return null;
  }

  aiUsageCount++;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `
${PERSONA}

データ：
${JSON.stringify(SCHOOL_DATA)}

質問：
${userMessage}
                  `
                }
              ]
            }
          ]
        })
      }
    );

    const data = await res.json();

    console.log("AI:", JSON.stringify(data, null, 2));

    if (data.error) return null;

    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;

  } catch (e) {
    console.error("AIエラー:", e);
    return null;
  }
}

// ===== メイン処理 =====
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const userMessage = event.message.text;
  const weekday = getTodayWeekday();

  console.log("----");
  console.log("入力:", userMessage);

  // ① ルール
  const rule = ruleBasedResponse(userMessage, weekday);
  if (rule) {
    console.log("→ルール");
    return reply(event, wisut(rule));
  }

  // ② AI
  const ai = await callAI(userMessage);
  if (ai) {
    console.log("→AI");
    return reply(event, ai);
  }

  // ③ 完全フォールバック
  console.log("→フォールバック");

  return reply(
    event,
    wisut("ごめんね\nちょっと考えごとしてた")
  );
}

// ===== 返信 =====
function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: "text",
    text
  });
}

// ===== Webhook =====
app.post("/webhook", middleware(config), async (req, res) => {
  await Promise.all(req.body.events.map(handleEvent));
  res.json({ success: true });
});

// ===== 起動 =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server running on " + PORT);
});
