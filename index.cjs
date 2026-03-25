// index.cjs - ZDG Bot completo e fixado
require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require("discord.js");
const fetch = require("node-fetch"); // ✅ Corrige fetch no Node.js CommonJS

// =======================
// CONFIGURAÇÃO (ENV)
// =======================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const API_BASE = process.env.API_BASE_URL;
const API_KEY = process.env.API_KEY;
const REDEEM_LOG_CHANNEL_ID = process.env.REDEEM_LOG_CHANNEL_ID;
const ROLE_BLACKLIST_BYPASS_ID = process.env.ROLE_BLACKLIST_BYPASS_ID;
const ROLE_CODEGEN_ID = process.env.ROLE_CODEGEN_ID;
const ROLE_MOD_ID = process.env.ROLE_MOD_ID;
const POLL_SECONDS = Math.max(3, Number(process.env.POLL_SECONDS || 5));

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !API_BASE || !API_KEY) {
  console.error("Faltou configurar ENV (TOKEN/CLIENT_ID/GUILD_ID/API_BASE/API_KEY).");
  process.exit(1);
}

// =======================
// UTILIDADES
// =======================
function hasRole(member, roleId) {
  return roleId ? member?.roles?.cache?.has(roleId) : false;
}

function infoEmbed(title) {
  return new EmbedBuilder().setTitle(title).setColor(0x2B2D31);
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

async function sendRedeemLogIfNew(client, lastRedeemIdHolder) {
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

// =======================
// BOT
// =======================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const lastRedeemIdHolder = { lastId: 0 };

// Ready
client.once("clientReady", async () => {
  console.log(`✔ Online: ${client.user.tag}`);

  // Registra comandos
  const commands = [
    new SlashCommandBuilder().setName("ping").setDescription("Checa se o bot tá online"),
    new SlashCommandBuilder().setName("redeemcheck").setDescription("Checa último code redeem"),
    new SlashCommandBuilder().setName("gencode").setDescription("Gera um code novo").addStringOption(opt => opt.setName("type").setDescription("Tipo do code").setRequired(true))
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✔ Slash commands registrados no servidor");

  setInterval(() => sendRedeemLogIfNew(client, lastRedeemIdHolder), POLL_SECONDS * 1000);
});

// Comandos
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    if (commandName === "ping") {
      await interaction.reply({ content: "🏓 Pong!", ephemeral: true });
    } else if (commandName === "redeemcheck") {
      await interaction.deferReply({ ephemeral: true });
      const { ok, json } = await apiGet("/redeems/latest");
      await interaction.editReply(ok ? `Último redeem: ${JSON.stringify(json)}` : "Erro ao checar.");
    } else if (commandName === "gencode") {
      await interaction.deferReply({ ephemeral: true });
      const type = interaction.options.getString("type");
      const { ok, json } = await apiPost("/codes/generate", { type });
      await interaction.editReply(ok ? `Novo code: \`${json.code}\`` : "Erro ao gerar code.");
    }
  } catch (err) {
    console.error("Erro na interação:", err);
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply("Erro interno no bot.");
    } else {
      await interaction.reply({ content: "Erro interno no bot.", ephemeral: true });
    }
  }
});

client.login(TOKEN);
