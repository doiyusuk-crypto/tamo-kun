import express from "express";

const app = express();
app.use(express.json());

app.post("/webhook", (req, res) => {
  console.log("受信:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("Bot is running!");
});

app.listen(3000, () => {
  console.log("Server running");
});