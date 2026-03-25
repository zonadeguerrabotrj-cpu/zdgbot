require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} = require("discord.js");

// =====================
// ENV CONFIG
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

// Checagem de ENV
if (!TOKEN || !CLIENT_ID || !GUILD_ID || !API_BASE || !API_KEY) {
  console.error("Faltou configurar .env (TOKEN/CLIENT_ID/GUILD_ID/API_BASE_URL/API_KEY).");
  process.exit(1);
}

// =====================
// HELPERS
// =====================
function hasRole(member, roleId) {
  return roleId && member?.roles?.cache?.has(roleId);
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
  if (["perma", "perm", "permanent"].includes(raw)) return "Permanent";

  const m = raw.match(/^(\d+)\s*(s|m|h|d)$/);
  if (!m) return null;

  const n = Number(m[1]);
  const unit = m[2];
  if (!Number.isFinite(n) || n <= 0) return null;

  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return n * mult;
}

async function apiPost(endpoint, body) {
  const res = await fetch(`${API_BASE}/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
  return json;
}

async function apiGetPublic(endpointWithQuery) {
  const res = await fetch(`${API_BASE}${endpointWithQuery}`, { method: "GET" });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

// =====================
// LISTAS
// =====================
const WEAPONS = ["IMI Galil", "AR15 de 100", "AK DA FAZENDA", "AR MARPAT", "G3", "GLOCK TC"];
const BLACKLIST = ["MINIGUN", "RPG"].map(x => x.toUpperCase());

function isBlacklistedWeapon(name) { return BLACKLIST.includes(String(name || "").toUpperCase()); }
function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function genCodeString() { return Array.from({length:10}, ()=>"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random()*36)]).join(""); }
function normalizeTypeInput(type) { return String(type || "").trim(); }
function normalizeValueInput(value) {
  if (typeof value === "boolean") return value;
  const v = String(value ?? "").trim();
  if (v.toLowerCase() === "true") return true;
  if (v.toLowerCase() === "false") return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

// =====================
// SLASH COMMANDS
// =====================
const commands = [
  new SlashCommandBuilder()
    .setName("gencode")
    .setDescription("Gera códigos de um tipo específico (arma, money, vip, etc)")
    .addStringOption(o => o.setName("type").setDescription("Ex: IMI Galil | money | vip").setRequired(true))
    .addStringOption(o => o.setName("value").setDescription("Arma: true/false | Money: 38000 | Vip: true").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Quantidade de códigos (1-100)").setRequired(true)),

  new SlashCommandBuilder()
    .setName("genrand")
    .setDescription("Gera códigos de armas aleatórias da lista")
    .addIntegerOption(o => o.setName("amount").setDescription("Quantidade de códigos (1-100)").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Aplica banimento de jogador")
    .addStringOption(o => o.setName("identificador").setDescription("UserId, username ou @username").setRequired(true))
    .addStringOption(o => o.setName("duração").setDescription("perma | 30m | 2h | 7d").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo do ban").setRequired(true)),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Remove banimento de jogador")
    .addStringOption(o => o.setName("identificador").setDescription("UserId, username ou @username").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo do unban").setRequired(true)),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick de jogador (one-shot)")
    .addStringOption(o => o.setName("identificador").setDescription("UserId, username ou @username").setRequired(true))
    .addStringOption(o => o.setName("motivo").setDescription("Motivo do kick").setRequired(true)),
].map(c => c.toJSON());

// =====================
// REGISTER COMMANDS
// =====================
async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("✔ Slash commands registrados no servidor");
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
  if (lastRedeemId === 0) { lastRedeemId = id; return; }
  lastRedeemId = id;
  const ch = await client.channels.fetch(REDEEM_LOG_CHANNEL_ID).catch(() => null);
  if (!ch) return;
  const emb = new EmbedBuilder()
    .setTitle("Code Redeemed")
    .setColor(0x57F287)
    .addFields(
      { name: "Player", value: json.playerName || "—", inline: true },
      { name: "ID", value: json.playerId ? String(json.playerId) : "—", inline: true },
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

// =====================
// READY & POLLING
// =====================
client.once("ready", async () => {
  console.log(`✔ Online: ${client.user.tag}`);
  await registerCommands();
  setInterval(sendRedeemLogIfNew, POLL_SECONDS * 1000);
});

// =====================
// INTERACTIONS
// =====================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const member = interaction.member;
  const isMod = hasRole(member, ROLE_MOD_ID);
  const canGen = hasRole(member, ROLE_CODEGEN_ID);

  try {
    // /gencode
    if (interaction.commandName === "gencode") {
      if (!canGen) return interaction.reply({ embeds: [denyEmbed("Sem permissão", "Você não tem permissão pra gerar códigos.")], ephemeral: true });
      const type = normalizeTypeInput(interaction.options.getString("type", true));
      const value = normalizeValueInput(interaction.options.getString("value", true));
      const amount = interaction.options.getInteger("amount", true);
      if (amount < 1 || amount > 100) return interaction.reply({ embeds: [denyEmbed("Quantidade inválida", "O amount deve ser entre 1 e 100.")], ephemeral: true });

      const isWeapon = WEAPONS.map(w => w.toUpperCase()).includes(type.toUpperCase());
      if (isWeapon && isBlacklistedWeapon(type) && !hasRole(member, ROLE_BLACKLIST_BYPASS_ID)) return interaction.reply({ embeds: [denyEmbed("Bloqueado", `A arma ${type} está na blacklist.`)], ephemeral: true });
      if (isWeapon && value !== true && !hasRole(member, ROLE_BLACKLIST_BYPASS_ID)) return interaction.reply({ embeds: [denyEmbed("Value inválido", "Para arma, value precisa ser true.")], ephemeral: true });

      await interaction.deferReply({ ephemeral: false });
      const codes = [];
      for (let i = 0; i < amount; i++) {
        const code = genCodeString();
        await apiPost("create", { code, type, reward: value, adminDiscord: `${interaction.user.username} (${interaction.user.id})` });
        codes.push(code);
      }

      const emb = infoEmbed(`${amount} Código(s) gerado(s)`)
        .setColor(0x2B2D31)
        .addFields(
          { name: "Type", value: type, inline: true },
          { name: "Value", value: String(value), inline: true },
          { name: "Total", value: String(amount), inline: true },
          { name: "Codes", value: codes.map(c=>`\`${c}\``).join("\n").slice(0,3900), inline: false }
        ).setFooter({ text: `Generated by ${interaction.user.username} (${interaction.user.id})` })
         .setTimestamp(new Date());

      await interaction.editReply({ embeds: [emb] });
      if (MOD_LOG_CHANNEL_ID) { const ch = await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(() => null); if (ch) ch.send({ embeds: [emb] }).catch(()=>{}); }
      return;
    }

    // /genrand
    if (interaction.commandName === "genrand") {
      if (!canGen) return interaction.reply({ embeds: [denyEmbed("Sem permissão", "Você não tem permissão pra gerar códigos.")], ephemeral: true });
      const amount = interaction.options.getInteger("amount", true);
      if (amount < 1 || amount > 100) return interaction.reply({ embeds: [denyEmbed("Quantidade inválida", "O amount deve ser entre 1 e 100.")], ephemeral: true });

      await interaction.deferReply({ ephemeral: false });
      const codes = [];
      const picked = [];
      const pool = hasRole(member, ROLE_BLACKLIST_BYPASS_ID) ? WEAPONS : WEAPONS.filter(w => !isBlacklistedWeapon(w));
      if (pool.length === 0) return interaction.editReply({ embeds: [denyEmbed("Sem pool", "Nenhuma arma disponível (tudo em blacklist).")] });

      for (let i = 0; i < amount; i++) {
        const weapon = randPick(pool);
        const code = genCodeString();
        await apiPost("create", { code, type: weapon, reward: true, adminDiscord: `${interaction.user.username} (${interaction.user.id})` });
        codes.push(code);
        picked.push(weapon);
      }

      const summary = picked.slice(0,12).join(", ") + (picked.length>12 ? "..." : "");
      const emb = infoEmbed(`${amount} Código(s) aleatório(s)`)
        .setColor(0x2B2D31)
        .addFields(
          { name: "Type", value: "Random Weapons", inline: true },
          { name: "Value", value: "true", inline: true },
          { name: "Total", value: String(amount), inline: true },
          { name: "Picked", value: summary, inline: false },
          { name: "Codes", value: codes.map(c=>`\`${c}\``).join("\n").slice(0,3900), inline: false }
        )
        .setFooter({ text: `Generated by ${interaction.user.username} (${interaction.user.id})` })
        .setTimestamp(new Date());
      await interaction.editReply({ embeds: [emb] });
      if (MOD_LOG_CHANNEL_ID) { const ch = await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(() => null); if (ch) ch.send({ embeds: [emb] }).catch(()=>{}); }
      return;
    }

    // /ban, /unban, /kick
    if (["ban","unban","kick"].includes(interaction.commandName) && !isMod) return interaction.reply({ embeds: [denyEmbed("Sem permissão","Você não tem permissão pra usar moderação.")], ephemeral:true });

    if (interaction.commandName === "ban") {
      const identificador = interaction.options.getString("identificador", true);
      const duracaoStr = interaction.options.getString("duração", true);
      const motivo = interaction.options.getString("motivo", true);
      const durationMs = parseDurationToMs(duracaoStr);
      if (durationMs === null) return interaction.reply({ embeds: [denyEmbed("Duração inválida","Use: perma | 30m | 2h | 7d")], ephemeral:true });
      await apiPost("ban",{ robloxUser: identificador, reason: motivo, durationMs, adminDiscord:`${interaction.user.username} (${interaction.user.id})` });
      const emb = new EmbedBuilder().setTitle("Ban aplicado").setColor(0xED4245)
        .addFields({ name:"Identificador", value:`\`${identificador}\``, inline:false },
                   { name:"Duração", value: durationMs==="Permanent"?"Permanente":formatMs(durationMs), inline:true },
                   { name:"Motivo", value: motivo, inline:false },
                   { name:"Moderator", value:`${interaction.user.username} (${interaction.user.id})`, inline:false })
        .setTimestamp(new Date());
      await interaction.reply({ embeds: [emb] });
      if (MOD_LOG_CHANNEL_ID) { const ch = await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(()=>null); if(ch)ch.send({embeds:[emb]}).catch(()=>{});}
      return;
    }

    if (interaction.commandName === "unban") {
      const identificador = interaction.options.getString("identificador", true);
      const motivo = interaction.options.getString("motivo", true);
      await apiPost("unban",{ robloxUser: identificador, reason: motivo, adminDiscord:`${interaction.user.username} (${interaction.user.id})` });
      const emb = new EmbedBuilder().setTitle("Unban aplicado").setColor(0x57F287)
        .addFields({ name:"Identificador", value:`\`${identificador}\``, inline:false }, { name:"Motivo", value: motivo, inline:false }, { name:"Moderator", value:`${interaction.user.username} (${interaction.user.id})`, inline:false })
        .setTimestamp(new Date());
      await interaction.reply({ embeds: [emb] });
      if (MOD_LOG_CHANNEL_ID) { const ch = await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(()=>null); if(ch)ch.send({embeds:[emb]}).catch(()=>{});}
      return;
    }

    if (interaction.commandName === "kick") {
      const identificador = interaction.options.getString("identificador", true);
      const motivo = interaction.options.getString("motivo", true);
      await apiPost("kick",{ robloxUser: identificador, reason: motivo, adminDiscord:`${interaction.user.username} (${interaction.user.id})` });
      const emb = new EmbedBuilder().setTitle("Kick solicitado").setColor(0xFEE75C)
        .addFields({ name:"Identificador", value:`\`${identificador}\``, inline:false }, { name:"Motivo", value: motivo, inline:false }, { name:"Moderator", value:`${interaction.user.username} (${interaction.user.id})`, inline:false })
        .setTimestamp(new Date());
      await interaction.reply({ embeds: [emb] });
      if (MOD_LOG_CHANNEL_ID) { const ch = await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(()=>null); if(ch)ch.send({embeds:[emb]}).catch(()=>{});}
      return;
    }

  } catch (err) {
    console.error("Erro na interação:", err);
    interaction.reply({ embeds: [denyEmbed("Erro interno", String(err))], ephemeral:true });
  }
});

// =====================
// LOGIN
// =====================
client.login(TOKEN);
