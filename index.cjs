// index.cjs
require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require("discord.js");

// fetch no Node 22 (CommonJS)
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const API_BASE = process.env.API_BASE_URL;
const API_KEY = process.env.API_KEY;
const REDEEM_LOG_CHANNEL_ID = process.env.REDEEM_LOG_CHANNEL_ID;
const MOD_LOG_CHANNEL_ID = process.env.MOD_LOG_CHANNEL_ID;
const ROLE_MOD_ID = process.env.ROLE_MOD_ID;
const ROLE_CODEGEN_ID = process.env.ROLE_CODEGEN_ID;
const ROLE_BLACKLIST_BYPASS_ID = process.env.ROLE_BLACKLIST_BYPASS_ID;
const POLL_SECONDS = Math.max(3, Number(process.env.POLL_SECONDS || 5));

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !API_BASE || !API_KEY) {
  console.error("Faltou configurar ENV (TOKEN/CLIENT_ID/GUILD_ID/API_BASE/API_KEY).");
  process.exit(1);
}

function hasRole(member, roleId) {
  return roleId ? member?.roles?.cache?.has(roleId) : false;
}

function denyEmbed(title, desc) {
  return new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0xFF5555);
}

function infoEmbed(title) {
  return new EmbedBuilder().setTitle(title).setColor(0x2B2D31);
}

function formatMs(ms) {
  if (!ms || ms === "Permanent") return "Permanente";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function parseDurationToMs(input) {
  if (!input) return "Permanent";
  const raw = String(input).trim().toLowerCase();
  if (raw === "perma" || raw === "perm" || raw === "permanent") return "Permanent";
  const m = raw.match(/^(\d+)\s*(s|m|h|d)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * mult;
}

async function apiPost(endpoint, body) {
  const res = await fetch(`${API_BASE}/api/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.message || json?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

async function apiGetPublic(endpointWithQuery) {
  const res = await fetch(`${API_BASE}${endpointWithQuery}`, { method: "GET" });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

// =======================
// Bot & Commands
// =======================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let lastRedeemId = 0;

async function sendRedeemLogIfNew() {
  if (!REDEEM_LOG_CHANNEL_ID) return;
  const { ok, json } = await apiGetPublic("/api/checkredeemlog");
  if (!ok || !json) return;
  const id = Number(json.id || 0);
  if (!id || id === lastRedeemId) return;
  if (lastRedeemId === 0) { lastRedeemId = id; return; }
  lastRedeemId = id;

  const ch = await client.channels.fetch(REDEEM_LOG_CHANNEL_ID).catch(() => null);
  if (!ch) return;

  const emb = new EmbedBuilder()
    .setTitle("Code Redeemed")
    .setColor(0x57F287)
    .addFields(
      { name: "Player", value: json.playerName || "—", inline: true },
      { name: "ID", value: json.playerId || "—", inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
      { name: "Type", value: json.type || "—", inline: true },
      { name: "Value", value: json.value != null ? String(json.value) : "—", inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
      { name: "Code", value: json.code ? `\`${json.code}\`` : "—", inline: false },
      { name: "Moderator", value: json.moderator || "system", inline: false }
    )
    .setFooter({ text: "Code Redeem System" })
    .setTimestamp(new Date(Number(json.createdAt || Date.now())));

  await ch.send({ embeds: [emb] });
}

client.once("ready", async () => {
  console.log(`✔ Online: ${client.user.tag}`);
  // registra comandos
  const commands = [
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Checa se o bot tá online")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✔ Slash commands registrados no servidor");

  setInterval(sendRedeemLogIfNew, POLL_SECONDS * 1000);
});

client.login(TOKEN);
