require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");

const express = require("express");
const app = express();

// =====================
// EXPRESS (ANTI-SLEEP)
// =====================
app.get("/", (req, res) => res.send("online"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Web server ativo na porta " + PORT);
});

// =====================
// ENV
// =====================
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
  console.error("Faltou configurar ENV.");
  process.exit(1);
}

// =====================
// UTILS
// =====================
function hasRole(member, roleId) {
  return member?.roles?.cache?.has(roleId);
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
  const raw = String(input).toLowerCase();
  if (["perma","perm","permanent"].includes(raw)) return "Permanent";

  const m = raw.match(/^(\d+)(s|m|h|d)$/);
  if (!m) return null;

  const n = Number(m[1]);
  const unit = m[2];

  const mult = unit === "s" ? 1000 :
               unit === "m" ? 60000 :
               unit === "h" ? 3600000 :
               86400000;

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
  try { json = JSON.parse(text); } catch { json = {}; }

  if (!res.ok) throw new Error(json.message || "Erro API");
  return json;
}

async function apiGetPublic(endpoint) {
  const res = await fetch(`${API_BASE}${endpoint}`);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = {}; }
  return { ok: res.ok, json };
}

// =====================
// DADOS
// =====================
const WEAPONS = [
  "IMI Galil",
  "AR15 de 100",
  "AK DA FAZENDA",
  "AR MARPAT",
  "G3",
  "GLOCK TC"
];

const BLACKLIST = ["MINIGUN","RPG"];

function isBlacklistedWeapon(name) {
  return BLACKLIST.includes(String(name).toUpperCase());
}

function randPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function genCodeString() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 10; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

// =====================
// COMMANDS
// =====================
const commands = [
  new SlashCommandBuilder()
    .setName("gencode")
    .setDescription("Gerar códigos")
    .addStringOption(o => o.setName("type").setRequired(true))
    .addStringOption(o => o.setName("value").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setRequired(true)),

  new SlashCommandBuilder()
    .setName("genrand")
    .setDescription("Armas aleatórias")
    .addIntegerOption(o => o.setName("amount").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Banir jogador")
    .addStringOption(o => o.setName("identificador").setRequired(true))
    .addStringOption(o => o.setName("duração").setRequired(true))
    .addStringOption(o => o.setName("motivo").setRequired(true)),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Remover ban")
    .addStringOption(o => o.setName("identificador").setRequired(true))
    .addStringOption(o => o.setName("motivo").setRequired(true)),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick")
    .addStringOption(o => o.setName("identificador").setRequired(true))
    .addStringOption(o => o.setName("motivo").setRequired(true))
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✔ Comandos registrados");
}

// =====================
// CLIENT
// =====================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
      { name: "Player", value: String(json.playerName || "-"), inline: true },
      { name: "ID", value: String(json.playerId || "-"), inline: true },
      { name: "Type", value: String(json.type || "-"), inline: true },
      { name: "Value", value: String(json.value || "-"), inline: true },
      { name: "Code", value: `\`${json.code || "-"}\`` }
    )
    .setTimestamp(new Date());

  await ch.send({ embeds: [emb] });
}

client.once("ready", async () => {
  console.log(`✔ Online: ${client.user.tag}`);
  await registerCommands();
  setInterval(sendRedeemLogIfNew, POLL_SECONDS * 1000);
});

// =====================
// INTERAÇÕES
// =====================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;

  const isMod = hasRole(member, ROLE_MOD_ID);
  const canGen = hasRole(member, ROLE_CODEGEN_ID);

  if ((interaction.commandName === "gencode" || interaction.commandName === "genrand") && !canGen) {
    return interaction.reply({ embeds: [denyEmbed("Sem permissão","Sem acesso")], ephemeral: true });
  }

  if ((interaction.commandName === "ban" || interaction.commandName === "unban" || interaction.commandName === "kick") && !isMod) {
    return interaction.reply({ embeds: [denyEmbed("Sem permissão","Mod apenas")], ephemeral: true });
  }

  try {
    if (interaction.commandName === "gencode") {
      const type = interaction.options.getString("type");
      const value = interaction.options.getString("value");
      const amount = interaction.options.getInteger("amount");

      await interaction.deferReply();

      const codes = [];

      for (let i = 0; i < amount; i++) {
        const code = genCodeString();

        await apiPost("create", {
          code,
          type,
          reward: value,
          adminDiscord: interaction.user.username
        });

        codes.push(code);
      }

      await interaction.editReply({
        embeds: [infoEmbed("Códigos gerados")
          .addFields({ name:"Codes", value: codes.join("\n") })]
      });
    }

    if (interaction.commandName === "genrand") {
      const amount = interaction.options.getInteger("amount");

      await interaction.deferReply();

      const codes = [];

      for (let i = 0; i < amount; i++) {
        const weapon = randPick(WEAPONS);
        const code = genCodeString();

        await apiPost("create", {
          code,
          type: weapon,
          reward: true,
          adminDiscord: interaction.user.username
        });

        codes.push(code);
      }

      await interaction.editReply({
        embeds: [infoEmbed("Random gerado")
          .addFields({ name:"Codes", value: codes.join("\n") })]
      });
    }

    if (interaction.commandName === "ban") {
      const id = interaction.options.getString("identificador");
      const dur = parseDurationToMs(interaction.options.getString("duração"));
      const motivo = interaction.options.getString("motivo");

      await apiPost("ban",{ robloxUser:id, reason:motivo, durationMs:dur });

      await interaction.reply({ content:"Ban aplicado" });
    }

    if (interaction.commandName === "unban") {
      const id = interaction.options.getString("identificador");
      const motivo = interaction.options.getString("motivo");

      await apiPost("unban",{ robloxUser:id, reason:motivo });

      await interaction.reply({ content:"Unban aplicado" });
    }

    if (interaction.commandName === "kick") {
      const id = interaction.options.getString("identificador");
      const motivo = interaction.options.getString("motivo");

      await apiPost("kick",{ robloxUser:id, reason:motivo });

      await interaction.reply({ content:"Kick enviado" });
    }

  } catch (e) {
    return interaction.reply({
      embeds: [denyEmbed("Erro", String(e.message))]
    });
  }
});

client.login(TOKEN);
