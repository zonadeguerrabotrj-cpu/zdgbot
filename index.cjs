// index.cjs
require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const fetch = require("node-fetch");

// ====== CONFIGURAÇÃO ======
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

// ====== FUNÇÕES AUX ======
function hasRole(member, roleId) {
  return roleId && member?.roles?.cache?.has(roleId);
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
  const res = await fetch(`${API_BASE}${endpointWithQuery}`);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

// ====== LISTAS ======
const WEAPONS = ["IMI Galil", "AR15 de 100", "AK DA FAZENDA", "AR MARPAT", "G3", "GLOCK TC"];
const BLACKLIST = ["MINIGUN", "RPG"].map(x => x.toUpperCase());

function isBlacklistedWeapon(name) {
  return BLACKLIST.includes(String(name || "").toUpperCase());
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

function normalizeTypeInput(type) {
  return String(type || "").trim();
}

function normalizeValueInput(value) {
  if (typeof value === "boolean") return value;
  const v = String(value ?? "").trim();
  if (v.toLowerCase() === "true") return true;
  if (v.toLowerCase() === "false") return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

// ====== SLASH COMMANDS ======
const commands = [
  new SlashCommandBuilder()
    .setName("gencode")
    .setDescription("Gera códigos de um type específico (arma, money, vip, etc)")
    .addStringOption(o => o.setName("type").setDescription("Ex: IMI Galil | money | vip").setRequired(true))
    .addStringOption(o => o.setName("value").setDescription("Arma: true/false | Money: 38000 | Vip: true").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Quantidade (máx 100)").setRequired(true)),

  new SlashCommandBuilder()
    .setName("genrand")
    .setDescription("Gera códigos de armas aleatórias")
    .addIntegerOption(o => o.setName("amount").setDescription("Quantidade (máx 100)").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Banir jogador")
    .addStringOption(o => o.setName("identificador").setDescription("UserId, username ou @username").setRequired(true))
    .addStringOption(o => o.setName("duração").setDescription("perma | 30m | 2h | 7d").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo do ban").setRequired(true)),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Remover ban")
    .addStringOption(o => o.setName("identificador").setDescription("UserId, username ou @username").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo do unban").setRequired(true)),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick (one-shot)")
    .addStringOption(o => o.setName("identificador").setDescription("UserId, username ou @username").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo do kick").setRequired(true)),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✔ Slash commands registrados no servidor");
}

// ====== CLIENT ======
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

let lastRedeemId = 0;

async function sendRedeemLogIfNew() {
  if (!REDEEM_LOG_CHANNEL_ID) return;

  const { ok, json } = await apiGetPublic("/api/checkredeemlog");
  if (!ok || !json) return;

  const id = Number(json.id || 0);
  if (!id || id === lastRedeemId) return;

  if (lastRedeemId === 0) {
    lastRedeemId = id;
    return;
  }

  lastRedeemId = id;

  const ch = await client.channels.fetch(REDEEM_LOG_CHANNEL_ID).catch(() => null);
  if (!ch) return;

  const emb = new EmbedBuilder()
    .setTitle("Code Redeemed")
    .setColor(0x57F287)
    .addFields(
      { name: "Player", value: json.playerName ? String(json.playerName) : "—", inline: true },
      { name: "ID", value: json.playerId ? String(json.playerId) : "—", inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
      { name: "Type", value: json.type ? String(json.type) : "—", inline: true },
      { name: "Value", value: json.value != null ? String(json.value) : "—", inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
      { name: "Code", value: json.code ? `\`${String(json.code)}\`` : "—", inline: false },
      { name: "Moderator", value: json.moderator ? String(json.moderator) : "system", inline: false }
    )
    .setFooter({ text: "Code Redeem System" })
    .setTimestamp(new Date(Number(json.createdAt || Date.now())));

  await ch.send({ embeds: [emb] });
}

client.once("ready", async () => {
  console.log(`✔ Online: ${client.user.tag}`);
  await registerCommands();
  setInterval(sendRedeemLogIfNew, POLL_SECONDS * 1000);
});

// ====== INTERAÇÕES ======
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const isMod = hasRole(member, ROLE_MOD_ID);
  const canGen = hasRole(member, ROLE_CODEGEN_ID);

  try {
    if (interaction.commandName === "gencode") {
      const typeRaw = interaction.options.getString("type", true);
      const valueRaw = interaction.options.getString("value", true);
      const amount = interaction.options.getInteger("amount", true);

      if (amount < 1 || amount > 100) return interaction.reply({ embeds: [denyEmbed("Quantidade inválida", "O amount deve ser entre 1 e 100.")], ephemeral: true });

      const type = normalizeTypeInput(typeRaw);
      const value = normalizeValueInput(valueRaw);

      const isWeapon = WEAPONS.map(w => w.toUpperCase()).includes(String(type).toUpperCase());
      if (isWeapon && isBlacklistedWeapon(type) && !hasRole(member, ROLE_BLACKLIST_BYPASS_ID)) {
        return interaction.reply({ embeds: [denyEmbed("Bloqueado por blacklist", `A arma **${type}** está na blacklist.`)], ephemeral: true });
      }

      if (isWeapon && value !== true && !hasRole(member, ROLE_BLACKLIST_BYPASS_ID)) {
        return interaction.reply({ embeds: [denyEmbed("Value inválido", "Pra arma funcionar, o value precisa ser **true**.")], ephemeral: true });
      }

      await interaction.deferReply();
      const codes = [];
      for (let i = 0; i < amount; i++) {
        const code = genCodeString();
        await apiPost("create", { code, type, reward: value, adminDiscord: `${interaction.user.username} (${interaction.user.id})` });
        codes.push(code);
      }

      const emb = infoEmbed(`${amount} Código(s) gerado(s)`)
        .addFields(
          { name: "Type", value: String(type), inline: true },
          { name: "Value", value: String(value), inline: true },
          { name: "Total", value: String(amount), inline: true },
          { name: "Codes", value: codes.map(c => `\`${c}\``).join("\n").slice(0, 3900), inline: false }
        )
        .setFooter({ text: `Generated by ${interaction.user.username} (${interaction.user.id})` })
        .setTimestamp(new Date());

      await interaction.editReply({ embeds: [emb] });
      if (MOD_LOG_CHANNEL_ID) client.channels.fetch(MOD_LOG_CHANNEL_ID).then(ch => ch.send({ embeds: [emb] }).catch(() => {}));

      return;
    }

    // Aqui você adicionaria genrand, ban, unban, kick de forma similar...
    
  } catch (e) {
    const emb = denyEmbed("Falha", String(e?.message || e));
    if (interaction.deferred || interaction.replied) return interaction.editReply({ embeds: [emb] }).catch(() => {});
    return interaction.reply({ embeds: [emb], ephemeral: true }).catch(() => {});
  }
});

client.login(TOKEN);
