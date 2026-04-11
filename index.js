import express from "express";

const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = "aJTndzz8ufGZD65UnC+vrwSTJFOjYs07zG1E1uPq5GwEORODjmVm1sWJEvElFj9T0R7MPZsYe8LEdTE4V9MIvwKZu8/AWL9m6TWPQHFOC08TMw5vAEen9/EYZwBaJ4wMf1P7gpSthUyEKsZuYfCnUAdB04t89/1O/w1cDnyilFU=";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;

      try {
        // 👇 Gemini API呼び出し
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
              text: `あなたは優しい家族向けアシスタントです。子供にも分かりやすく答えてください。\n\n${userMessage}`
            }
          ]
        }
      ]
    })
  }
);

const data = await aiRes.json();
console.log("Gemini:", JSON.stringify(data, null, 2));

const replyText =
  data.candidates?.[0]?.content?.parts?.[0]?.text ||
  "うまく答えられませんでした";

        // 👇 LINEに返信
        await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${CHANNEL_ACCESS_TOKEN}`
          },
          body: JSON.stringify({
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: replyText
              }
            ]
          })
        });
      } catch (err) {
        console.error("エラー:", err);
      }
    }
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("Bot is running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
