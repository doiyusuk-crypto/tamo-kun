import express from "express";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Bot is running!");
});

app.post("/webhook", (req, res) => {
  console.log("Webhook受信！");
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
