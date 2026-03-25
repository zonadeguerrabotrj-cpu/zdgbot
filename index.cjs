// index.cjs
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");

// ==========================
// CONFIGURAÇÃO (ENV)
// ==========================
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
let API_BASE = process.env.API_BASE_URL;
const API_KEY = process.env.API_KEY;

const REDEEM_LOG_CHANNEL_ID = process.env.REDEEM_LOG_CHANNEL_ID;
const MOD_LOG_CHANNEL_ID = process.env.MOD_LOG_CHANNEL_ID;

const ROLE_MOD_ID = process.env.ROLE_MOD_ID;
const ROLE_CODEGEN_ID = process.env.ROLE_CODEGEN_ID;
const ROLE_BLACKLIST_BYPASS_ID = process.env.ROLE_BLACKLIST_BYPASS_ID;

const POLL_SECONDS = Math.max(3, Number(process.env.POLL_SECONDS || 5));

// Validações
if (!TOKEN || !CLIENT_ID || !GUILD_ID || !API_BASE || !API_KEY) {
  console.error("❌ Faltou configurar .env (TOKEN/CLIENT_ID/GUILD_ID/API_BASE_URL/API_KEY).");
  process.exit(1);
}

// Remove barra final da base URL para evitar duplicidade
if (API_BASE.endsWith("/")) API_BASE = API_BASE.slice(0, -1);

// ==========================
// FUNÇÕES AUXILIARES
// ==========================
function hasRole(member, roleId) {
  if (!roleId) return false;
  return member?.roles?.cache?.has(roleId);
}

function denyEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`❌ ${title}`)
    .setDescription(description)
    .setColor(0xff5555)
    .setTimestamp();
}

function okEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(`✅ ${title}`)
    .setDescription(description)
    .setColor(0x55ff7f)
    .setTimestamp();
}

function infoEmbed(title) {
  return new EmbedBuilder()
    .setTitle(`ℹ️ ${title}`)
    .setColor(0x2b2d31)
    .setTimestamp();
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

  const mult = unit === "s" ? 1000 :
               unit === "m" ? 60_000 :
               unit === "h" ? 3_600_000 :
               86_400_000;
  return n * mult;
}

// ==========================
// FUNÇÕES DE API (corrigidas)
// ==========================
async function apiPost(endpoint, body) {
  const url = `${API_BASE}/api/${endpoint}`;
  console.log(`[API] POST ${url}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    if (!res.ok) {
      const msg = json?.message || json?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json;
  } catch (err) {
    console.error(`[API] Erro em POST ${endpoint}:`, err.message);
    throw err;
  }
}

async function apiGetPublic(endpointWithQuery) {
  const url = `${API_BASE}${endpointWithQuery}`;
  console.log(`[API] GET ${url}`);
  try {
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    console.error(`[API] Erro em GET ${url}:`, err.message);
    return { ok: false, status: 0, json: null };
  }
}

// ==========================
// LÓGICA DO BOT
// ==========================
const WEAPONS = [
  "IMI Galil",
  "AR15 de 100",
  "AK DA FAZENDA",
  "AR MARPAT",
  "G3",
  "GLOCK TC",
];

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
  const v = String(value ?? "").trim();
  if (v.toLowerCase() === "true") return true;
  if (v.toLowerCase() === "false") return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

// ==========================
// COMANDOS SLASH
// ==========================
const commands = [
  new SlashCommandBuilder()
    .setName("gencode")
    .setDescription("Gera códigos de um type específico (arma, money, vip, etc)")
    .addStringOption(o => o.setName("type").setDescription("Ex: IMI Galil | money | vip").setRequired(true))
    .addStringOption(o => o.setName("value").setDescription("Arma: true/false | Money: 38000 | Vip: true").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Quantidade (máx 100)").setRequired(true)),

  new SlashCommandBuilder()
    .setName("genrand")
    .setDescription("Gera códigos de armas aleatórias (lista no index.js)")
    .addIntegerOption(o => o.setName("amount").setDescription("Quantidade (máx 100)").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Banir jogador (blacklist)")
    .addStringOption(o => o.setName("identificador").setDescription("UserId, username ou @username").setRequired(true))
    .addStringOption(o => o.setName("duração").setDescription("perma | 30m | 2h | 7d").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo do ban").setRequired(true)),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Remover ban (blacklist)")
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

// ==========================
// LOG DE REDEEMS
// ==========================
let lastRedeemId = 0;

async function sendRedeemLogIfNew(client) {
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
    .setTitle("🎮 Code Redeemed")
    .setColor(0x57F287)
    .addFields(
      { name: "👤 Player", value: json.playerName ? String(json.playerName) : "—", inline: true },
      { name: "🆔 ID", value: json.playerId ? String(json.playerId) : "—", inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
      { name: "📦 Type", value: json.type ? String(json.type) : "—", inline: true },
      { name: "💰 Value", value: json.value != null ? String(json.value) : "—", inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
      { name: "🔑 Code", value: json.code ? `\`${String(json.code)}\`` : "—", inline: false },
      { name: "🛡️ Moderator", value: json.moderator ? String(json.moderator) : "system", inline: false }
    )
    .setFooter({ text: "Code Redeem System", iconURL: client.user.displayAvatarURL() })
    .setTimestamp(new Date(Number(json.createdAt || Date.now())));

  await ch.send({ embeds: [emb] });
  console.log(`[Redeem] Log enviado para ${REDEEM_LOG_CHANNEL_ID}`);
}

// ==========================
// CLIENTE DO DISCORD
// ==========================
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", async () => {
  console.log(`✔ Online: ${client.user.tag}`);
  await registerCommands();

  // Inicia polling de resgates
  setInterval(() => sendRedeemLogIfNew(client), POLL_SECONDS * 1000);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const isMod = hasRole(member, ROLE_MOD_ID);
  const canGen = hasRole(member, ROLE_CODEGEN_ID);

  // Verificar permissões
  if ((interaction.commandName === "gencode" || interaction.commandName === "genrand") && !canGen) {
    return interaction.reply({ embeds: [denyEmbed("Sem permissão", "Você não tem permissão para gerar códigos.")], ephemeral: true });
  }

  if ((interaction.commandName === "ban" || interaction.commandName === "unban" || interaction.commandName === "kick") && !isMod) {
    return interaction.reply({ embeds: [denyEmbed("Sem permissão", "Você não tem permissão para usar moderação.")], ephemeral: true });
  }

  try {
    // ========== /gencode ==========
    if (interaction.commandName === "gencode") {
      const typeRaw = interaction.options.getString("type", true);
      const valueRaw = interaction.options.getString("value", true);
      const amount = interaction.options.getInteger("amount", true);

      if (amount < 1 || amount > 100) {
        return interaction.reply({ embeds: [denyEmbed("Quantidade inválida", "O amount deve ser entre 1 e 100.")], ephemeral: true });
      }

      const type = normalizeTypeInput(typeRaw);
      const value = normalizeValueInput(valueRaw);
      const isWeapon = WEAPONS.map(w => w.toUpperCase()).includes(type.toUpperCase());

      if (isWeapon && isBlacklistedWeapon(type) && !hasRole(member, ROLE_BLACKLIST_BYPASS_ID)) {
        return interaction.reply({ embeds: [denyEmbed("Bloqueado por blacklist", `A arma **${type}** está na blacklist.`)], ephemeral: true });
      }

      if (isWeapon && value !== true && !hasRole(member, ROLE_BLACKLIST_BYPASS_ID)) {
        return interaction.reply({ embeds: [denyEmbed("Value inválido", "Para armas, o value precisa ser **true**.")], ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: false });

      const codes = [];
      for (let i = 0; i < amount; i++) {
        const code = genCodeString();
        await apiPost("create", {
          code,
          type,
          reward: value,
          adminDiscord: `${interaction.user.username} (${interaction.user.id})`,
        });
        codes.push(code);
      }

      const emb = new EmbedBuilder()
        .setTitle(`✨ ${amount} Código(s) Gerado(s)`)
        .setColor(0x2b2d31)
        .addFields(
          { name: "📌 Type", value: String(type), inline: true },
          { name: "💎 Value", value: String(value), inline: true },
          { name: "🔢 Total", value: String(amount), inline: true },
          { name: "📜 Códigos", value: codes.map(c => `\`${c}\``).join("\n").slice(0, 3900), inline: false }
        )
        .setFooter({ text: `Gerado por ${interaction.user.username} (${interaction.user.id})`, iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();

      await interaction.editReply({ embeds: [emb] });

      if (MOD_LOG_CHANNEL_ID) {
        const logCh = await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(() => null);
        if (logCh) logCh.send({ embeds: [emb] }).catch(() => {});
      }
      return;
    }

    // ========== /genrand ==========
    if (interaction.commandName === "genrand") {
      const amount = interaction.options.getInteger("amount", true);
      if (amount < 1 || amount > 100) {
        return interaction.reply({ embeds: [denyEmbed("Quantidade inválida", "O amount deve ser entre 1 e 100.")], ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: false });

      const pool = hasRole(member, ROLE_BLACKLIST_BYPASS_ID)
        ? WEAPONS
        : WEAPONS.filter(w => !isBlacklistedWeapon(w));

      if (pool.length === 0) {
        return interaction.editReply({ embeds: [denyEmbed("Sem pool", "Nenhuma arma disponível (tudo em blacklist).")] });
      }

      const codes = [];
      const picked = [];
      for (let i = 0; i < amount; i++) {
        const weapon = randPick(pool);
        const code = genCodeString();
        await apiPost("create", {
          code,
          type: weapon,
          reward: true,
          adminDiscord: `${interaction.user.username} (${interaction.user.id})`,
        });
        codes.push(code);
        picked.push(weapon);
      }

      const summary = picked.slice(0, 12).join(", ") + (picked.length > 12 ? "..." : "");

      const emb = new EmbedBuilder()
        .setTitle(`🎲 ${amount} Código(s) Aleatório(s)`)
        .setColor(0x2b2d31)
        .addFields(
          { name: "📌 Type", value: "Random Weapons", inline: true },
          { name: "💎 Value", value: "true", inline: true },
          { name: "🔢 Total", value: String(amount), inline: true },
          { name: "🎯 Armas sorteadas", value: summary, inline: false },
          { name: "📜 Códigos", value: codes.map(c => `\`${c}\``).join("\n").slice(0, 3900), inline: false }
        )
        .setFooter({ text: `Gerado por ${interaction.user.username} (${interaction.user.id})`, iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();

      await interaction.editReply({ embeds: [emb] });

      if (MOD_LOG_CHANNEL_ID) {
        const logCh = await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(() => null);
        if (logCh) logCh.send({ embeds: [emb] }).catch(() => {});
      }
      return;
    }

    // ========== /ban ==========
    if (interaction.commandName === "ban") {
      const identificador = interaction.options.getString("identificador", true);
      const duracaoStr = interaction.options.getString("duração", true);
      const motivo = interaction.options.getString("motivo", true);

      const durationMs = parseDurationToMs(duracaoStr);
      if (durationMs === null) {
        return interaction.reply({ embeds: [denyEmbed("Duração inválida", "Use: perma | 30m | 2h | 7d")], ephemeral: true });
      }

      await apiPost("ban", {
        robloxUser: identificador,
        reason: motivo,
        durationMs,
        adminDiscord: `${interaction.user.username} (${interaction.user.id})`,
      });

      const emb = new EmbedBuilder()
        .setTitle("🔨 Ban aplicado")
        .setColor(0xed4245)
        .addFields(
          { name: "👤 Identificador", value: `\`${identificador}\``, inline: false },
          { name: "⏱️ Duração", value: durationMs === "Permanent" ? "Permanente" : formatMs(durationMs), inline: true },
          { name: "📝 Motivo", value: motivo, inline: false },
          { name: "🛡️ Moderador", value: `${interaction.user.username} (${interaction.user.id})`, inline: false }
        )
        .setFooter({ text: "Ação registrada", iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();

      await interaction.reply({ embeds: [emb] });

      if (MOD_LOG_CHANNEL_ID) {
        const logCh = await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(() => null);
        if (logCh) logCh.send({ embeds: [emb] }).catch(() => {});
      }
      return;
    }

    // ========== /unban ==========
    if (interaction.commandName === "unban") {
      const identificador = interaction.options.getString("identificador", true);
      const motivo = interaction.options.getString("motivo", true);

      await apiPost("unban", {
        robloxUser: identificador,
        reason: motivo,
        adminDiscord: `${interaction.user.username} (${interaction.user.id})`,
      });

      const emb = new EmbedBuilder()
        .setTitle("✅ Unban aplicado")
        .setColor(0x57f287)
        .addFields(
          { name: "👤 Identificador", value: `\`${identificador}\``, inline: false },
          { name: "📝 Motivo", value: motivo, inline: false },
          { name: "🛡️ Moderador", value: `${interaction.user.username} (${interaction.user.id})`, inline: false }
        )
        .setFooter({ text: "Ação registrada", iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();

      await interaction.reply({ embeds: [emb] });

      if (MOD_LOG_CHANNEL_ID) {
        const logCh = await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(() => null);
        if (logCh) logCh.send({ embeds: [emb] }).catch(() => {});
      }
      return;
    }

    // ========== /kick ==========
    if (interaction.commandName === "kick") {
      const identificador = interaction.options.getString("identificador", true);
      const motivo = interaction.options.getString("motivo", true);

      await apiPost("kick", {
        robloxUser: identificador,
        reason: motivo,
        adminDiscord: `${interaction.user.username} (${interaction.user.id})`,
      });

      const emb = new EmbedBuilder()
        .setTitle("👢 Kick solicitado")
        .setColor(0xfee75c)
        .addFields(
          { name: "👤 Identificador", value: `\`${identificador}\``, inline: false },
          { name: "📝 Motivo", value: motivo, inline: false },
          { name: "🛡️ Moderador", value: `${interaction.user.username} (${interaction.user.id})`, inline: false }
        )
        .setFooter({ text: "Ação registrada", iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();

      await interaction.reply({ embeds: [emb] });

      if (MOD_LOG_CHANNEL_ID) {
        const logCh = await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(() => null);
        if (logCh) logCh.send({ embeds: [emb] }).catch(() => {});
      }
      return;
    }

  } catch (error) {
    const errorMessage = error?.message || "Erro desconhecido";
    const emb = denyEmbed("Falha na execução", errorMessage);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [emb] }).catch(() => {});
    } else {
      await interaction.reply({ embeds: [emb], ephemeral: true }).catch(() => {});
    }
    console.error(`[Erro no comando ${interaction.commandName}]`, error);
  }
});

client.login(TOKEN);
