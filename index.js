import express from "express";

const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = "aJTndzz8ufGZD65UnC+vrwSTJFOjYs07zG1E1uPq5GwEORODjmVm1sWJEvElFj9T0R7MPZsYe8LEdTE4V9MIvwKZu8/AWL9m6TWPQHFOC08TMw5vAEen9/EYZwBaJ4wMf1P7gpSthUyEKsZuYfCnUAdB04t89/1O/w1cDnyilFU=";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;

      // 👇 ChatGPTに問い合わせ
      const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: [
            {
              role: "system",
              content: "あなたは優しい家族アシスタントです。子供にもわかりやすく答えてください。"
            },
            {
              role: "user",
              content: userMessage
            }
          ]
        })
      });

      const data = await aiRes.json();
      const replyText = data.choices[0].message.content;

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
