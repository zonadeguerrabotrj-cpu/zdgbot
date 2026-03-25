// =====================
// index.js – ZDG Bot Fixado para Railway
// =====================

require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");

// =====================
// VARIÁVEIS DO ENV
// =====================
const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  API_BASE_URL,
  API_KEY,
  REDEEM_LOG_CHANNEL_ID,
  MOD_LOG_CHANNEL_ID,
  ROLE_MOD_ID,
  ROLE_CODEGEN_ID,
  ROLE_BLACKLIST_BYPASS_ID
} = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID || !API_BASE_URL || !API_KEY) {
  console.error("❌ Faltou configurar .env (TOKEN/CLIENT_ID/GUILD_ID/API_BASE_URL/API_KEY).");
  process.exit(1);
}

// =====================
// FUNÇÕES AUX
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

function genCodeString() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function apiPost(endpoint, body) {
  const res = await fetch(`${API_BASE_URL}/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
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
  const res = await fetch(`${API_BASE_URL}${endpointWithQuery}`);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

// =====================
// WEAPONS / BLACKLIST
// =====================
const WEAPONS = ["IMI Galil","AR15 de 100","AK DA FAZENDA","AR MARPAT","G3","GLOCK TC"];
const BLACKLIST = ["MINIGUN","RPG"].map(x => x.toUpperCase());

function isBlacklistedWeapon(name) {
  return BLACKLIST.includes(String(name || "").toUpperCase());
}

function randPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// =====================
// SLASH COMMANDS
// =====================
const commands = [
  new SlashCommandBuilder()
    .setName("gencode")
    .setDescription("Gera códigos de um type específico (arma, money, vip)")
    .addStringOption(o => o.setName("type").setDescription("Ex: IMI Galil | money | vip").setRequired(true))
    .addStringOption(o => o.setName("value").setDescription("Arma: true/false | Money: 38000 | Vip: true").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Quantidade (máx 100)").setRequired(true)),

  new SlashCommandBuilder()
    .setName("genrand")
    .setDescription("Gera códigos de armas aleatórias (lista no index.js)")
    .addIntegerOption(o => o.setName("amount").setDescription("Quantidade (máx 100)").setRequired(true))
].map(c => c.toJSON());

// =====================
// CLIENT DISCORD
// =====================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✔ Slash commands registrados no servidor");
}

client.once("ready", async () => {
  console.log(`✔ Online: ${client.user.tag}`);
  await registerCommands();
});

// =====================
// INTERAÇÕES
// =====================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const canGen = hasRole(member, ROLE_CODEGEN_ID);

  try {
    if (interaction.commandName === "gencode") {
      if (!canGen) return interaction.reply({ embeds: [denyEmbed("Sem permissão","Você não pode gerar códigos.")], ephemeral: true });

      const type = interaction.options.getString("type");
      const value = interaction.options.getString("value");
      const amount = interaction.options.getInteger("amount");

      if (amount < 1 || amount > 100) return interaction.reply({ embeds: [denyEmbed("Quantidade inválida","1-100 apenas.")], ephemeral: true });

      await interaction.deferReply({ ephemeral: false });

      const codes = [];
      for (let i = 0; i < amount; i++) {
        const code = genCodeString();
        await apiPost("create", { code, type, reward: value, adminDiscord: `${interaction.user.username} (${interaction.user.id})` });
        codes.push(code);
      }

      const emb = infoEmbed(`${amount} Código(s) gerado(s)`)
        .addFields({ name: "Type", value: type, inline: true },
                   { name: "Value", value: String(value), inline: true },
                   { name: "Codes", value: codes.map(c => `\`${c}\``).join("\n").slice(0, 3900), inline: false });

      await interaction.editReply({ embeds: [emb] });
    }

    if (interaction.commandName === "genrand") {
      if (!canGen) return interaction.reply({ embeds: [denyEmbed("Sem permissão","Você não pode gerar códigos.")], ephemeral: true });

      const amount = interaction.options.getInteger("amount");
      if (amount < 1 || amount > 100) return interaction.reply({ embeds: [denyEmbed("Quantidade inválida","1-100 apenas.")], ephemeral: true });

      await interaction.deferReply({ ephemeral: false });

      const codes = [];
      for (let i = 0; i < amount; i++) {
        const weapon = randPick(WEAPONS.filter(w => !isBlacklistedWeapon(w)));
        const code = genCodeString();
        await apiPost("create", { code, type: weapon, reward: true, adminDiscord: `${interaction.user.username} (${interaction.user.id})` });
        codes.push(code);
      }

      const emb = infoEmbed(`${amount} Código(s) aleatório(s)`)
        .addFields({ name: "Codes", value: codes.map(c => `\`${c}\``).join("\n").slice(0, 3900), inline: false });

      await interaction.editReply({ embeds: [emb] });
    }
  } catch (e) {
    const emb = denyEmbed("Erro", String(e?.message || e));
    if (interaction.deferred || interaction.replied) return interaction.editReply({ embeds: [emb] }).catch(() => {});
    return interaction.reply({ embeds: [emb], ephemeral: true }).catch(() => {});
  }
});

client.login(DISCORD_TOKEN);

// =====================
// EXPRESS SERVER (KEEP ALIVE RAILWAY)
// =====================
const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => res.send("Bot online ✅"));
app.listen(PORT, () => console.log(`✔ Express rodando na porta ${PORT}`));
