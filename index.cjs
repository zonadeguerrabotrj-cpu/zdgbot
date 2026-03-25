// index.cjs
require("dotenv").config();

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require("discord.js");

// =======================
// CONFIGURAÇÃO (ENV)
// =======================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
let API_BASE = process.env.API_BASE_URL;
const API_KEY = process.env.API_KEY;
const REDEEM_LOG_CHANNEL_ID = process.env.REDEEM_LOG_CHANNEL_ID;
const POLL_SECONDS = Math.max(3, Number(process.env.POLL_SECONDS || 5));

// Remove barra final da base URL se existir, para evitar duplicidade
if (API_BASE && API_BASE.endsWith('/')) {
  API_BASE = API_BASE.slice(0, -1);
}

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !API_BASE || !API_KEY) {
  console.error("Faltou configurar ENV. Verifique: DISCORD_TOKEN, CLIENT_ID, GUILD_ID, API_BASE_URL, API_KEY");
  process.exit(1);
}

// =======================
// FUNÇÕES DE API (com logs)
// =======================
async function apiGet(endpoint) {
  const url = `${API_BASE}${endpoint}`;
  console.log(`[API] GET ${url}`);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "Authorization": API_KEY }
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[API] Erro HTTP ${res.status} em GET ${endpoint}:`, text);
      return { ok: false, json: null };
    }
    try {
      return { ok: true, json: JSON.parse(text) };
    } catch (parseErr) {
      console.error(`[API] JSON inválido em GET ${endpoint}:`, text);
      return { ok: false, json: null };
    }
  } catch (fetchErr) {
    console.error(`[API] Falha de rede em GET ${endpoint}:`, fetchErr.message);
    return { ok: false, json: null };
  }
}

async function apiPost(endpoint, body = {}) {
  const url = `${API_BASE}${endpoint}`;
  console.log(`[API] POST ${url}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Authorization": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[API] Erro HTTP ${res.status} em POST ${endpoint}:`, text);
      return { ok: false, json: null };
    }
    try {
      return { ok: true, json: JSON.parse(text) };
    } catch (parseErr) {
      console.error(`[API] JSON inválido em POST ${endpoint}:`, text);
      return { ok: false, json: null };
    }
  } catch (fetchErr) {
    console.error(`[API] Falha de rede em POST ${endpoint}:`, fetchErr.message);
    return { ok: false, json: null };
  }
}

// =======================
// LOGS DE REDEEM
// =======================
const lastRedeemIdHolder = { lastId: 0 };

async function sendRedeemLogIfNew(client) {
  if (!REDEEM_LOG_CHANNEL_ID) {
    console.warn("[Redeem] REDEEM_LOG_CHANNEL_ID não configurado, ignorando.");
    return;
  }

  try {
    const { ok, json } = await apiGet("/redeems/latest");
    if (!ok || !json) {
      console.warn("[Redeem] Resposta inválida da API");
      return;
    }

    const id = Number(json.id || 0);
    if (!id || id === lastRedeemIdHolder.lastId) return;

    if (lastRedeemIdHolder.lastId === 0) {
      lastRedeemIdHolder.lastId = id;
      console.log(`[Redeem] Último ID inicializado: ${id}`);
      return;
    }

    lastRedeemIdHolder.lastId = id;

    const ch = await client.channels.fetch(REDEEM_LOG_CHANNEL_ID).catch(err => {
      console.error(`[Redeem] Canal ${REDEEM_LOG_CHANNEL_ID} não encontrado:`, err.message);
      return null;
    });
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
    console.log(`[Redeem] Log enviado para o canal ${REDEEM_LOG_CHANNEL_ID}`);
  } catch (err) {
    console.error("[Redeem] Erro inesperado em sendRedeemLogIfNew:", err);
  }
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
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✔ Slash commands registrados no servidor");
  } catch (err) {
    console.error("❌ Falha ao registrar comandos:", err);
  }

  setInterval(() => sendRedeemLogIfNew(client), POLL_SECONDS * 1000);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "ping") {
    await interaction.reply({ content: "🏓 Pong!", ephemeral: true });
  }
});

client.login(TOKEN);
