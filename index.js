// ===== AI管理 =====
let aiUsageCount = 0;
const AI_LIMIT = 15;

// ===== 人格設定 =====
const PERSONA = `
あなたは優しくてちょっとフレンドリーな小学校サポートAIです。
保護者と子供の両方にわかりやすく、やさしい口調で答えてください。
短く、親しみやすく話してください。
`;

// ===== AI呼び出し =====
async function callAI(userMessage) {
  if (aiUsageCount >= AI_LIMIT) {
    console.log("AI制限モード");
    return null; // ← AI使わない
  }

  aiUsageCount++;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `
${PERSONA}

以下の情報を元に答えてください：
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

  if (data.error) {
    console.log("AIエラー:", data.error);
    return null;
  }

  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// ===== ルール応答 =====
function ruleBasedResponse(userMessage, weekday) {

  // 下校
  if (userMessage.includes("下校") || userMessage.includes("帰り")) {
    const gradeMatch = userMessage.match(/[1-6]/);
    const grade = gradeMatch ? gradeMatch[0] : null;

    if (!grade) return "何年生か教えてね😊";

    const time = SCHOOL_DATA.time_rules.dismissal_matrix[weekday]?.[grade];
    return `${grade}年生は ${time} 下校だよ！`;
  }

  // 持ち物
  if (
    userMessage.includes("持ち物") ||
    userMessage.includes("準備")
  ) {
    const items = [
      ...SCHOOL_DATA.items.daily,
      ...(SCHOOL_DATA.items.weekly[weekday] || []),
      ...SCHOOL_DATA.items.lunch.required
    ];

    return `今日の持ち物だよ👇\n\n・${items.join("\n・")}`;
  }

  // 登校
  if (userMessage.includes("登校")) {
    const { start, end } = SCHOOL_DATA.time_rules.arrival;
    return `登校は ${start}〜${end} だよ！`;
  }

  return null;
}

// ===== 人格フィルター =====
function applyPersona(text) {
  if (!text) return null;

  return text
    .replace(/です/g, "だよ")
    .replace(/ます/g, "よ")
    + " 😊";
}

// ===== メイン処理 =====
async function generateResponse(userMessage) {
  const weekday = getTodayWeekday();

  // ① ルール
  const rule = ruleBasedResponse(userMessage, weekday);
  if (rule) {
    console.log("ルール応答");
    return applyPersona(rule);
  }

  // ② AI
  const ai = await callAI(userMessage);
  if (ai) {
    console.log("AI応答");
    return ai;
  }

  // ③ 最終フォールバック（ノーAI）
  console.log("完全フォールバック");

  return applyPersona("ごめんね、今ちょっと頭が疲れてるみたい💦でも基本ルールなら答えられるよ！");
}
