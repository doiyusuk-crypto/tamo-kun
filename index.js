import express from "express";

const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = "aJTndzz8ufGZD65UnC+vrwSTJFOjYs07zG1E1uPq5GwEORODjmVm1sWJEvElFj9T0R7MPZsYe8LEdTE4V9MIvwKZu8/AWL9m6TWPQHFOC08TMw5vAEen9/EYZwBaJ4wMf1P7gpSthUyEKsZuYfCnUAdB04t89/1O/w1cDnyilFU=";

app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;

      // オウム返し
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
              text: `あなたは「${userMessage}」と言いました`
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
