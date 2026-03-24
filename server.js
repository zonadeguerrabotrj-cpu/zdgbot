const express = require("express");
const app = express();

app.use(express.json());

// banco fake (memória)
let codes = [];

// criar código (bot usa)
app.post("/api/create", (req, res) => {
  const { code, type, reward, adminDiscord } = req.body;

  codes.push({
    code,
    type,
    reward,
    used: false,
    admin: adminDiscord
  });

  res.json({ success: true });
});

// resgatar (roblox usa)
app.post("/api/redeem", (req, res) => {
  const { code } = req.body;

  const found = codes.find(c => c.code === code && !c.used);

  if (!found) {
    return res.status(404).json({ error: "Código inválido" });
  }

  found.used = true;

  res.json({
    type: found.type,
    reward: found.reward
  });
});

// log simples
app.get("/api/checkredeemlog", (req, res) => {
  res.json({
    id: Date.now(),
    playerName: "teste",
    type: "weapon",
    value: "true"
  });
});

app.get("/", (req, res) => {
  res.send("API online");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API rodando"));
