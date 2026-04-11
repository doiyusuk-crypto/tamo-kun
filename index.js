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

// ===== データ読み込み =====
let SCHOOL_DATA = {};
let USERS = {};

try {
  SCHOOL_DATA = JSON.parse(fs.readFileSync("./school.json", "utf-8"));
  console.log("school.json OK");
} catch (e) {
  console.error("school.json NG", e);
}

try {
  USERS = JSON.parse(fs.readFileSync("./users.json", "utf-8"));
} catch {
  USERS = {};
}

// ===== 保存 =====
function saveUsers() {
  fs.writeFileSync("./users.json", JSON.stringify(USERS, null, 2));
}

// ===== AI管理 =====
let aiUsageCount = 0;
const AI_LIMIT = 10;

// ===== 曜日 =====
function getTodayWeekday() {
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[new Date().getDay()];
}

// ===== キャラ =====
function wisut(text) {
  const endings = [
    "いいね",
    "だいじょうぶ",
    "ゆっくりでいいよ",
    "気をつけてね"
  ];
  return text + "\n\n" + endings[Math.floor(Math.random() * endings.length)];
}

// ===== 学年登録 =====
function registerGrade(userId, text) {
  const grades = text.match(/[1-6]/g);
  if (!grades) return null;

  USERS[userId] = [...new Set(grades)];
  saveUsers();

  return `おぼえたよ

${grades.join("と")}ねんせいだね`;
}

// ===== 学年取得 =====
function getGrades(userId) {
  return USERS[userId] || [];
}

// ===== ルール処理 =====
function ruleBasedResponse(text, weekday, userId) {

  const grades = getGrades(userId);

  const events = SCHOOL_DATA?.events?.annual || [];
  const daily = SCHOOL_DATA?.items?.daily || [];
  const weekly = SCHOOL_DATA?.items?.weekly?.[weekday] || [];
  const lunch = SCHOOL_DATA?.items?.lunch?.required || [];

  // ===== 持ち物 =====
  if (/持ち物|なに持って|準備/.test(text)) {
    return `きょうのもちもの

${[...daily, ...weekly, ...lunch].join("\n")}`;
  }

  // ===== 下校 =====
  if (/下校|帰り/.test(text)) {

    if (grades.length > 0) {
      return grades.map(g => {
        const time = SCHOOL_DATA?.time_rules?.dismissal_matrix?.[weekday]?.[g];
        return `${g}ねんせい
${time}`;
      }).join("\n\n");
    }

    const g = text.match(/[1-6]/)?.[0];
    if (!g) return "なんねんせいか おしえてね";

    const time = SCHOOL_DATA?.time_rules?.dismissal_matrix?.[weekday]?.[g];
    return `${g}ねんせい
${time}`;
  }

  // ===== 登校 =====
  if (/登校/.test(text)) {
    const start = SCHOOL_DATA?.time_rules?.arrival?.start;
    const end = SCHOOL_DATA?.time_rules?.arrival?.end;
    return `とうこうは
${start}〜${end}`;
  }

  // ===== イベント =====
  if (/いつ/.test(text)) {
    for (const e of events) {
      if (text.includes(e.name)) {
        return `${e.name}は
${e.date}`;
      }
    }
  }

  // ===== 警報 =====
  if (/警報|台風/.test(text)) {
    return `けいほうのとき

7じ → たいき
10じまで → とうこう
それいこう → おやすみ`;
  }

  // ===== 休み =====
  if (/休む|欠席/.test(text)) {
    return `あさに れんらくしてね`;
  }

  return null;
}

// ===== AI =====
async function callAI(text) {
  if (!GEMINI_API_KEY) return null;
  if (aiUsageCount >= AI_LIMIT) return null;

  aiUsageCount++;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `やさしく短く答えて\n${JSON.stringify(SCHOOL_DATA)}\n質問:${text}`
            }]
          }]
        })
      }
    );

    const data = await res.json();
    if (data.error) return null;

    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;

  } catch {
    return null;
  }
}

// ===== メイン =====
async function handleEvent(event) {
  if (event.type !== "message") return;

  const text = event.message.text;
  const userId = event.source.userId;
  const weekday = getTodayWeekday();

  console.log("入力:", text);

  // ===== 学年登録 =====
  if (text.includes("年生")) {
    const msg = registerGrade(userId, text);
    if (msg) return reply(event, wisut(msg));
  }

  // ===== ルール =====
  const rule = ruleBasedResponse(text, weekday, userId);
  if (rule) {
    console.log("→ルール");
    return reply(event, wisut(rule));
  }

  // ===== AI =====
  const ai = await callAI(text);
  if (ai) {
    console.log("→AI");
    return reply(event, ai);
  }

  // ===== fallback =====
  return reply(event, wisut("よくわからなかったけど\nだいじなことならきいてね"));
}

// ===== 返信 =====
function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: "text",
    text
  });
}

// ===== webhook =====
app.post("/webhook", middleware(config), async (req, res) => {
  await Promise.all(req.body.events.map(handleEvent));
  res.json({ success: true });
});

// ===== 起動 =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server running on " + PORT);
});
