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
let SCHOOL_DATA = {};
try {
  SCHOOL_DATA = JSON.parse(
    fs.readFileSync("./school.json", "utf-8")
  );
  console.log("JSON読み込み成功");
} catch (e) {
  console.error("JSON読み込み失敗:", e);
}

// ===== AI管理 =====
let aiUsageCount = 0;
const AI_LIMIT = 15;

// ===== Persona =====
const PERSONA = `
やさしくて、ちょっとふしぎな雰囲気。
短い言葉で、やわらかく話す。
`;

// ===== ユーティリティ =====
function getTodayWeekday() {
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[new Date().getDay()];
}

// ===== キャラフィルター =====
function wisut(text) {
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

// ===== ルール処理（完全強化版）=====
function ruleBasedResponse(text, weekday) {

  // ===== 安全にデータ取得 =====
  const events = SCHOOL_DATA?.events?.annual || [];
  const daily = SCHOOL_DATA?.items?.daily || [];
  const weekly = SCHOOL_DATA?.items?.weekly?.[weekday] || [];
  const lunch = SCHOOL_DATA?.items?.lunch?.required || [];

  // =========================
  // 🎒 持ち物
  // =========================
  if (
    /持ち物|なに持って|何持って|準備|いるもの/.test(text)
  ) {
    return `きょうのもちもの

${[...daily, ...weekly, ...lunch].join("\n")}`;
  }

  // =========================
  // 🏫 登校
  // =========================
  if (/登校|何時に行く|何時から/.test(text)) {
    const start = SCHOOL_DATA?.time_rules?.arrival?.start;
    const end = SCHOOL_DATA?.time_rules?.arrival?.end;

    return `とうこうは

${start}〜${end}`;
  }

  // =========================
  // 🏃 下校
  // =========================
  if (/下校|帰り|何時に帰る/.test(text)) {
    const gradeMatch = text.match(/[1-6]/);
    const grade = gradeMatch ? gradeMatch[0] : null;

    if (!grade) return "なんねんせいか おしえてね";

    const time =
      SCHOOL_DATA?.time_rules?.dismissal_matrix?.[weekday]?.[grade];

    return `${grade}ねんせいは

${time}くらい`;
  }

  // =========================
  // 🎉 イベント（超強化）
  // =========================
  if (/いつ/.test(text)) {
    for (const e of events) {
      if (text.includes(e.name)) {
        return `${e.name}は

${e.date}だよ`;
      }
    }
  }

  // =========================
  // 🌧 警報
  // =========================
  if (/警報|休校|台風|雨/.test(text)) {
    return `けいほうのとき

7じ → じたくたいき
10じまで → かいじょなら とうこう
10じすぎ → おやすみ`;
  }

  // =========================
  // 🤒 休み
  // =========================
  if (/休む|欠席|休み/.test(text)) {
    return `あさに れんらくしてね`;
  }

  return null;
}

// ===== AI呼び出し =====
async function callAI(text) {
  if (!GEMINI_API_KEY) return null;

  if (aiUsageCount >= AI_LIMIT) {
    console.log("AI制限");
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

${JSON.stringify(SCHOOL_DATA)}

質問：
${text}
                  `
                }
              ]
            }
          ]
        })
      }
    );

    const data = await res.json();

    if (data.error) {
      console.log("AIエラー:", data.error);
      return null;
    }

    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;

  } catch (e) {
    console.error("AI失敗:", e);
    return null;
  }
}

// ===== メイン =====
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const text = event.message.text;
  const weekday = getTodayWeekday();

  console.log("入力:", text);

  // ===== ① ルール =====
  const rule = ruleBasedResponse(text, weekday);
  if (rule) {
    console.log("→ルール");
    return reply(event, wisut(rule));
  }

  // ===== ② AI =====
  const ai = await callAI(text);
  if (ai) {
    console.log("→AI");
    return reply(event, ai);
  }

  // ===== ③ フォールバック =====
  console.log("→フォールバック");

  return reply(
    event,
    wisut("よくわからなかったけど\nだいじなことなら きいてね")
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
