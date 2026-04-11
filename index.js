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

// ===== JSON読み込み（安定版）=====
const SCHOOL_DATA = JSON.parse(
  fs.readFileSync("./school.json", "utf-8")
);

// ===== Webhook =====
app.post("/webhook", middleware(config), async (req, res) => {
  const events = req.body.events;
  await Promise.all(events.map(handleEvent));
  res.json({ success: true });
});

// ===== ユーティリティ =====
function getTodayWeekday() {
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[new Date().getDay()];
}

function getDismissalTime(grade, weekday) {
  return SCHOOL_DATA.time_rules.dismissal_matrix[weekday]?.[grade] || null;
}

function getTodayItems(weekday) {
  return [
    ...SCHOOL_DATA.items.daily,
    ...(SCHOOL_DATA.items.weekly[weekday] || []),
    ...SCHOOL_DATA.items.lunch.required
  ];
}

// ===== 共通返信 =====
function reply(event, text) {
  return client.replyMessage(event.replyToken, {
    type: "text",
    text
  });
}

// ===== メイン処理 =====
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const userMessage = event.message.text;
  const weekday = getTodayWeekday();

  console.log("====== 新規リクエスト ======");
  console.log("ユーザー入力:", userMessage);
  console.log("曜日:", weekday);

  try {
    // ===== ① ルールベース処理 =====

    // --- 下校時間 ---
    if (userMessage.includes("下校") || userMessage.includes("帰り")) {
      console.log("分岐: 下校時間");

      const gradeMatch = userMessage.match(/[1-6]/);
      const grade = gradeMatch ? gradeMatch[0] : null;

      console.log("抽出学年:", grade);

      if (!grade) {
        return reply(event, "何年生か教えてください！（例：1年生）");
      }

      const time = getDismissalTime(grade, weekday);

      console.log("下校時間:", time);

      return reply(event, `${grade}年生の今日の下校時間は ${time} です`);
    }

    // --- 持ち物 ---
    if (
      userMessage.includes("持ち物") ||
      userMessage.includes("なに持って") ||
      userMessage.includes("何持って") ||
      userMessage.includes("準備")
    ) {
      console.log("分岐: 持ち物");

      const items = getTodayItems(weekday);

      console.log("持ち物:", items);

      return reply(event, `今日の持ち物です👇\n\n・${items.join("\n・")}`);
    }

    // --- 登校時間 ---
    if (userMessage.includes("登校")) {
      console.log("分岐: 登校時間");

      const { start, end } = SCHOOL_DATA.time_rules.arrival;

      return reply(event, `登校時間は ${start}〜${end} です`);
    }

    console.log("分岐: AI処理へフォールバック");

    // ===== ② AI補助 =====
    const aiRes = await fetch(
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
あなたは小学校ルールのアシスタントです。
以下のJSONデータを元に正確に答えてください。

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

    const data = await aiRes.json();

    console.log("AIレスポンス:", JSON.stringify(data, null, 2));

    let replyText = "うまく答えられませんでした";

    if (data.error) {
      replyText = `APIエラー: ${data.error.message}`;
    } else if (
      data.candidates &&
      data.candidates.length > 0 &&
      data.candidates[0].content?.parts?.length > 0
    ) {
      replyText = data.candidates[0].content.parts[0].text;
    }

    return reply(event, replyText);

  } catch (error) {
    console.error("全体エラー:", error);
    return reply(event, "エラーが発生しました😢");
  }
}

// ===== サーバー起動 =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server running on " + PORT);
});
