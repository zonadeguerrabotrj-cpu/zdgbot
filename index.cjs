// index.cjs
require("dotenv").config();
const fetch = require("node-fetch");
globalThis.fetch = fetch;

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");

// =======================
// CONFIGURAÇÃO (ENV)
// =======================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
let API_BASE = process.env.API_BASE_URL;
const API_KEY = process.env.API_KEY;
const REDEEM_LOG_CHANNEL_ID = process.env.REDEEM_LOG_CHANNEL_ID;
const ROLE_MOD_ID = process.env.ROLE_MOD_ID;
const ROLE_CODEGEN_ID = process.env.ROLE_CODEGEN_ID;
const ROLE_BLACKLIST_BYPASS_ID = process.env.ROLE_BLACKLIST_BYPASS_ID;
const POLL_SECONDS = Math.max(3, Number(process.env.POLL_SECONDS || 5));

if (API_BASE && API_BASE.endsWith('/')) API_BASE = API_BASE.slice(0, -1);

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !API_BASE || !API_KEY) {
  console.error("Faltou configurar ENV. Verifique: DISCORD_TOKEN, CLIENT_ID, GUILD_ID, API_BASE_URL, API_KEY");
  process.exit(1);
}

// =======================
// FUNÇÕES DE API
// =======================
async function apiGet(endpoint) {
  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url, { method: "GET", headers: { "Authorization": API_KEY } });
    const text = await res.text();
    return { ok: res.ok, json: JSON.parse(text || "{}") };
  } catch { return { ok: false, json: null }; }
}

async function apiPost(endpoint, body = {}) {
  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Authorization": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    return { ok: res.ok, json: JSON.parse(text || "{}") };
  } catch { return { ok: false, json: null }; }
}

// =======================
// REDEEM LOGS
// =======================
let lastRedeemId = 0;
async function sendRedeemLogIfNew(client) {
  if (!REDEEM_LOG_CHANNEL_ID) return;
  const { ok, json } = await apiGet("/redeems/latest");
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
      { name: "Code", value: json.code ? `\`${json.code}\`` : "—", inline: false },
      { name: "Moderator", value: json.moderator || "system", inline: false }
    )
    .setTimestamp(new Date(Number(json.createdAt || Date.now())));
  await ch.send({ embeds: [emb] });
}

// =======================
// COMANDOS
// =======================
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Checa se o bot tá online"),
  new SlashCommandBuilder()
    .setName("gencode")
    .setDescription("Gera um código para o usuário")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption(option => option.setName("usuario").setDescription("ID ou menção do usuário").setRequired(true)),
  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Adiciona ou remove usuário da blacklist")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption(option => option.setName("usuario").setDescription("ID do usuário").setRequired(true))
    .addBooleanOption(option => option.setName("remover").setDescription("Remover da blacklist?").setRequired(false))
];

// =======================
// CLIENT
// =======================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  console.log(`✔ Online: ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands.map(c => c.toJSON()) });
    console.log("✔ Slash commands registrados no servidor");
  } catch (err) {
    console.error("❌ Falha ao registrar comandos:", err);
  }

  setInterval(() => sendRedeemLogIfNew(client), POLL_SECONDS * 1000);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const memberRoles = interaction.member.roles;
  const isMod = memberRoles.cache.has(ROLE_MOD_ID);
  const isCodeGen = memberRoles.cache.has(ROLE_CODEGEN_ID);
  const isBypass = memberRoles.cache.has(ROLE_BLACKLIST_BYPASS_ID);

  try {
    if (interaction.commandName === "ping") {
      await interaction.reply({ content: "🏓 Pong!", ephemeral: true });
    }

    if (interaction.commandName === "gencode") {
      if (!isCodeGen && !isMod && !isBypass) return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });
      const userId = interaction.options.getString("usuario");
      const { ok, json } = await apiPost("/codes/generate", { userId });
      if (!ok) return interaction.reply({ content: "❌ Falha ao gerar código.", ephemeral: true });
      interaction.reply({ content: `✅ Código gerado para <@${userId}>: \`${json.code}\``, ephemeral: true });
    }

    if (interaction.commandName === "blacklist") {
      if (!isMod && !isBypass) return interaction.reply({ content: "❌ Sem permissão.", ephemeral: true });
      const userId = interaction.options.getString("usuario");
      const remover = interaction.options.getBoolean("remover") || false;
      const endpoint = remover ? `/blacklist/remove/${userId}` : `/blacklist/add/${userId}`;
      const { ok } = await apiPost(endpoint);
      if (!ok) return interaction.reply({ content: "❌ Falha ao atualizar blacklist.", ephemeral: true });
      interaction.reply({ content: `✅ Usuário ${userId} ${remover ? "removido" : "adicionado"} da blacklist.`, ephemeral: true });
    }
  } catch (err) {
    console.error("Erro na interação:", err);
    interaction.reply({ content: "❌ Ocorreu um erro.", ephemeral: true }).catch(() => null);
  }
});

client.login(TOKEN);
