require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");
const fetch = require("node-fetch");

// =====================
// CONFIGURAÇÃO
// =====================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const API_BASE = process.env.API_BASE_URL || "";
const API_KEY = process.env.API_KEY || "";

const REDEEM_LOG_CHANNEL_ID = process.env.REDEEM_LOG_CHANNEL_ID;
const MOD_LOG_CHANNEL_ID = process.env.MOD_LOG_CHANNEL_ID;

const ROLE_MOD_ID = process.env.ROLE_MOD_ID;
const ROLE_CODEGEN_ID = process.env.ROLE_CODEGEN_ID;
const ROLE_BLACKLIST_BYPASS_ID = process.env.ROLE_BLACKLIST_BYPASS_ID;

const POLL_SECONDS = Math.max(3, Number(process.env.POLL_SECONDS || 5));

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Faltou configurar variáveis no .env");
  process.exit(1);
}

// =====================
// FUNÇÕES AUXILIARES
// =====================
function hasRole(member, roleId) {
  return member?.roles?.cache?.has(roleId);
}

function denyEmbed(title, desc) {
  return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0xFF5555);
}

function okEmbed(title, desc) {
  return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0x55FF7F);
}

function infoEmbed(title) {
  return new EmbedBuilder().setTitle(title).setColor(0x2B2D31);
}

function randPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function genCodeString() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// =====================
// API HELPERS
// =====================
async function apiPost(endpoint, body) {
  if (!API_BASE || !API_KEY) return { success: false, error: "API não configurada" };
  const res = await fetch(`${API_BASE}/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
  return json;
}

async function apiGetPublic(endpoint) {
  const res = await fetch(`${API_BASE}${endpoint}`);
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

// =====================
// SLASH COMMANDS EXEMPLO
// =====================
const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Verifica se o bot está online")
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✔ Slash commands registrados");
}

// =====================
// CLIENT DISCORD
// =====================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`✔ Online: ${client.user.tag}`);
  await registerCommands();
});

// Interações
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    return interaction.reply({ content: "Pong! Bot está online ✅", ephemeral: true });
  }
});

client.login(TOKEN);

// =====================
// POLLING / LOGS (opcional)
// =====================
let lastRedeemId = 0;
async function sendRedeemLogIfNew() {
  if (!REDEEM_LOG_CHANNEL_ID) return;
  const { ok, json } = await apiGetPublic("/api/checkredeemlog");
  if (!ok || !json) return;

  const id = Number(json.id || 0);
  if (!id || id === lastRedeemId) return;
  lastRedeemId = id;

  const ch = await client.channels.fetch(REDEEM_LOG_CHANNEL_ID).catch(() => null);
  if (!ch) return;

  const emb = new EmbedBuilder()
    .setTitle("Code Redeemed")
    .setColor(0x57F287)
    .addFields(
      { name: "Player", value: json.playerName || "—", inline: true },
      { name: "ID", value: json.playerId || "—", inline: true },
      { name: "Code", value: json.code || "—", inline: false }
    )
    .setTimestamp(new Date(Number(json.createdAt || Date.now())));
  await ch.send({ embeds: [emb] });
}

setInterval(sendRedeemLogIfNew, POLL_SECONDS * 1000);

// =====================
// SERVIDOR HTTP PRA RAILWAY
// =====================
const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("Bot ZDG rodando!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor HTTP ativo na porta ${PORT}`));
