import express from "express";
import { Client, middleware } from "@line/bot-sdk";
import fetch from "node-fetch";
import { google } from "googleapis";

const app = express();

// ===== 環境変数 =====
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// ★ 修正ポイント
const client = new Client(config);

// ===== Google Drive =====
const drive = google.drive({
  version: "v3",
  auth: GOOGLE_API_KEY
});

// ===== Webhook =====
app.post("/webhook", middleware(config), async (req, res) => {
  const events = req.body.events;

  await Promise.all(events.map(handleEvent));

  res.json({ success: true });
});

// ===== メイン処理 =====
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const userMessage = event.message.text;

  try {
    // ===== ① Driveから画像一覧取得 =====
    const filesRes = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and mimeType contains 'image/'`,
      fields: "files(id, name)"
    });

    const files = filesRes.data.files || [];

    if (files.length === 0) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "フォルダに画像が見つかりませんでした"
      });
    }

    let allText = "";

    // ===== ② 画像を順番に解析 =====
    for (const file of files) {
      try {
        const res = await drive.files.get(
          { fileId: file.id, alt: "media" },
          { responseType: "arraybuffer" } // ★重要
        );

        const base64Image = Buffer.from(res.data).toString("base64");

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
                      text: "この画像は小学校のプリントです。内容を簡潔に要約してください"
                    },
                    {
                      inlineData: {
                        mimeType: "image/jpeg",
                        data: base64Image
                      }
                    }
                  ]
                }
              ]
            })
          }
        );

        const data = await aiRes.json();

        const text =
          data.candidates?.[0]?.content?.parts?.[0]?.text ||
          "(読み取れませんでした)";

        allText += `\n[${file.name}]\n${text}\n`;

      } catch (e) {
        console.error("画像解析エラー:", file.name, e);
      }
    }

    // ===== ③ 全情報から回答生成 =====
    const finalRes = await fetch(
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
以下は家族共有フォルダ内のプリント情報です：

${allText}

この情報を元に質問に答えてください：

${userMessage}
                  `
                }
              ]
            }
          ]
        })
      }
    );

    const finalData = await finalRes.json();

    const replyText =
      finalData.candidates?.[0]?.content?.parts?.[0]?.text ||
      "うまく答えられませんでした";

    // ===== LINE返信 =====
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: replyText
    });

  } catch (error) {
    console.error(error);

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "エラーが発生しました😢"
    });
  }
}

// ===== サーバー起動 =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server running on " + PORT);
});
