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
  const text = userMessage;

  // =========================
  // 🎒 持ち物
  // =========================
  if (
    text.includes("持ち物") ||
    text.includes("なに持って") ||
    text.includes("何持って") ||
    text.includes("準備") ||
    text.includes("いるもの")
  ) {
    const items = [
      ...SCHOOL_DATA.items.daily,
      ...(SCHOOL_DATA.items.weekly[weekday] || []),
      ...SCHOOL_DATA.items.lunch.required
    ];

    return `きょうのもちもの

${items.join("\n")}`;
  }

  // =========================
  // 🏫 登校
  // =========================
  if (
    text.includes("登校") ||
    text.includes("何時に行く") ||
    text.includes("何時から")
  ) {
    const { start, end } = SCHOOL_DATA.time_rules.arrival;
    return `とうこうは

${start}〜${end}`;
  }

  // =========================
  // 🏃 下校
  // =========================
  if (
    text.includes("下校") ||
    text.includes("帰り") ||
    text.includes("何時に帰る")
  ) {
    const gradeMatch = text.match(/[1-6]/);
    const grade = gradeMatch ? gradeMatch[0] : null;

    if (!grade) return "なんねんせいか おしえてね";

    const time =
      SCHOOL_DATA.time_rules.dismissal_matrix[weekday]?.[grade];

    return `${grade}ねんせいは

${time}くらい`;
  }

  // =========================
  // 🍱 給食
  // =========================
  if (text.includes("給食")) {
    const items = SCHOOL_DATA.items.lunch.required;

    return `きゅうしょくのとき

${items.join("\n")}`;
  }

  // =========================
  // 🎽 服装
  // =========================
  if (
    text.includes("服") ||
    text.includes("服装") ||
    text.includes("何着る")
  ) {
    return `うごきやすいふくがいいよ

フードはかぶらない`;
  }

  // =========================
  // 🌧 警報・休校
  // =========================
  if (
    text.includes("警報") ||
    text.includes("休校") ||
    text.includes("雨") ||
    text.includes("台風")
  ) {
    return `けいほうのとき

7じ → じたくたいき
10じまでにかいじょ → とうこう
10じでもでてたら → おやすみ`;
  }

  // =========================
  // 🤒 休み・体調
  // =========================
  if (
    text.includes("休む") ||
    text.includes("休み") ||
    text.includes("欠席")
  ) {
    return `あさに れんらくしてね`;
  }

  // =========================
  // 🎉 イベント系（最重要）
  // =========================
  if (text.includes("いつ")) {
    const event = SCHOOL_DATA.events.annual.find(e =>
      text.includes(e.name)
    );

    if (event) {
      return `${event.name}は

${event.date}だよ`;
    }
  }

  // =========================
  // 📅 明日・今日イベント
  // =========================
  if (
    text.includes("今日なに") ||
    text.includes("明日なに")
  ) {
    return `いまは

イベントないみたい`;
  }

  // =========================
  // 🧹 掃除・時間割っぽい
  // =========================
  if (text.includes("掃除")) {
    return `そうじは

きゅうしょくのあとだよ`;
  }

  // =========================
  // ⏰ 今何してる
  // =========================
  if (
    text.includes("今何") ||
    text.includes("いま何")
  ) {
    return `いまは

じゅぎょうかもね`;
  }

  // =========================
  // 📞 連絡
  // =========================
  if (
    text.includes("連絡") ||
    text.includes("電話")
  ) {
    return `がっこうに

でんわしてね`;
  }

  // =========================
  // ❌ 該当なし
  // =========================
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
