// index.cjs
require("dotenv").config();

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require("discord.js");

// =======================
// CONFIGURAÇÃO (ENV)
// =======================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const API_BASE = process.env.API_BASE_URL;
const API_KEY = process.env.API_KEY;
const REDEEM_LOG_CHANNEL_ID = process.env.REDEEM_LOG_CHANNEL_ID;
const POLL_SECONDS = Math.max(3, Number(process.env.POLL_SECONDS || 5));

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !API_BASE || !API_KEY) {
  console.error("Faltou configurar ENV.");
  process.exit(1);
}

// =======================
// FUNÇÕES DE API
// =======================
async function apiGet(endpoint) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "GET",
    headers: { "Authorization": API_KEY }
  });
  const text = await res.text();
  try { return { ok: res.ok, json: JSON.parse(text) }; } 
  catch { return { ok: res.ok, json: { raw: text } }; }
}

async function apiPost(endpoint, body = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Authorization": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  try { return { ok: res.ok, json: JSON.parse(text) }; } 
  catch { return { ok: res.ok, json: { raw: text } }; }
}

// =======================
// LOGS DE REDEEM
// =======================
const lastRedeemIdHolder = { lastId: 0 };
async function sendRedeemLogIfNew(client) {
  if (!REDEEM_LOG_CHANNEL_ID) return;
  const { ok, json } = await apiGet("/redeems/latest");
  if (!ok || !json) return;
  const id = Number(json.id || 0);
  if (!id || id === lastRedeemIdHolder.lastId) return;
  if (lastRedeemIdHolder.lastId === 0) { lastRedeemIdHolder.lastId = id; return; }
  lastRedeemIdHolder.lastId = id;

  const ch = await client.channels.fetch(REDEEM_LOG_CHANNEL_ID).catch(() => null);
  if (!ch) return;

  const emb = new EmbedBuilder()
    .setTitle("Code Redeemed")
    .setColor(0x57F287)
    .addFields(
      { name: "Player", value: json.playerName || "—", inline: true },
      { name: "ID", value: json.playerId || "—", inline: true },
      { name: "Code", value: json.code ? `\`${json.code}\`` : "—", inline: false },
      { name: "Moderator", value: json.moderator || "system", inline: false }
    )
    .setTimestamp(new Date(Number(json.createdAt || Date.now())));

  await ch.send({ embeds: [emb] });
}

// =======================
// BOT
// =======================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`✔ Online: ${client.user.tag}`);

  // Registra comandos
  const commands = [
    new SlashCommandBuilder().setName("ping").setDescription("Checa se o bot tá online")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✔ Slash commands registrados no servidor");

  setInterval(() => sendRedeemLogIfNew(client), POLL_SECONDS * 1000);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "ping") {
    await interaction.reply({ content: "🏓 Pong!", ephemeral: true });
  }
});

client.login(TOKEN);
