// index.cjs
require("dotenv").config();
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");

// =======================
// CONFIGURAÇÃO (ENV)
// =======================
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
  console.error("Faltou configurar .env (TOKEN/CLIENT_ID/GUILD_ID/API_BASE_URL/API_KEY).");
  process.exit(1);
}

// =======================
// FUNÇÕES AUXILIARES
// =======================
function hasRole(member, roleId) {
  if (!roleId) return false;
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
  const mult = unit === "s" ? 1000 : unit === "m" ? 60000 : unit === "h" ? 3600000 : 86400000;
  return n * mult;
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
// LISTAS DE ARMA/BLACKLIST
// =====================
const WEAPONS = ["IMI Galil","AR15 de 100","AK DA FAZENDA","AR MARPAT","G3","GLOCK TC"];
const BLACKLIST = ["MINIGUN","RPG"].map(x => x.toUpperCase());
function isBlacklistedWeapon(name) { return BLACKLIST.includes(String(name||"").toUpperCase()); }

// =======================
// API FUNCTIONS
// =======================
async function apiPost(endpoint, body={}) {
  try {
    const res = await fetch(`${API_BASE}/api/${endpoint}`, {
      method:"POST",
      headers: {"Content-Type":"application/json","x-api-key":API_KEY},
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
    return json;
  } catch(e) {
    console.error("❌ Falha ao chamar API POST", e.message);
    return null;
  }
}

async function apiGetPublic(endpoint) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, { method:"GET" });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw:text }; }
    return { ok: res.ok, status: res.status, json };
  } catch(e) {
    console.error("❌ Falha ao chamar API GET", e.message);
    return { ok:false, json:null };
  }
}

// =======================
// REDEEM LOG
// =======================
let lastRedeemId = 0;
async function sendRedeemLogIfNew(client) {
  if (!REDEEM_LOG_CHANNEL_ID) return;
  const { ok, json } = await apiGetPublic("/api/checkredeemlog");
  if (!ok || !json) return;
  const id = Number(json.id||0);
  if (!id || id===lastRedeemId) return;
  if(lastRedeemId===0){ lastRedeemId=id; return; }
  lastRedeemId=id;

  const ch = await client.channels.fetch(REDEEM_LOG_CHANNEL_ID).catch(()=>null);
  if(!ch) return;

  const emb = new EmbedBuilder()
    .setTitle("Code Redeemed")
    .setColor(0x57F287)
    .addFields(
      { name:"Player", value:json.playerName?String(json.playerName):"—", inline:true },
      { name:"ID", value:json.playerId?String(json.playerId):"—", inline:true },
      { name:"Type", value:json.type?String(json.type):"—", inline:true },
      { name:"Value", value:json.value!=null?String(json.value):"—", inline:true },
      { name:"Code", value:json.code?`\`${String(json.code)}\``:"—", inline:false },
      { name:"Moderator", value:json.moderator?String(json.moderator):"system", inline:false }
    )
    .setFooter({ text:"Code Redeem System" })
    .setTimestamp(new Date(Number(json.createdAt||Date.now())));
  await ch.send({ embeds:[emb] });
}

// =======================
// SLASH COMMANDS
// =======================
const commands = [
  new SlashCommandBuilder().setName("gencode").setDescription("Gera códigos de type específico")
    .addStringOption(o=>o.setName("type").setDescription("Ex: IMI Galil | money | vip").setRequired(true))
    .addStringOption(o=>o.setName("value").setDescription("Arma: true/false | Money: 38000 | Vip: true").setRequired(true))
    .addIntegerOption(o=>o.setName("amount").setDescription("Quantidade (1-100)").setRequired(true)),

  new SlashCommandBuilder().setName("genrand").setDescription("Gera códigos de armas aleatórias")
    .addIntegerOption(o=>o.setName("amount").setDescription("Quantidade (1-100)").setRequired(true)),

  new SlashCommandBuilder().setName("ban").setDescription("Banir jogador")
    .addStringOption(o=>o.setName("identificador").setDescription("UserId, username ou @username").setRequired(true))
    .addStringOption(o=>o.setName("duração").setDescription("perma | 30m | 2h | 7d").setRequired(true))
    .addStringOption(o=>o.setName("motivo").setDescription("Motivo do ban").setRequired(true)),

  new SlashCommandBuilder().setName("unban").setDescription("Remover ban")
    .addStringOption(o=>o.setName("identificador").setDescription("UserId, username ou @username").setRequired(true))
    .addStringOption(o=>o.setName("motivo").setDescription("Motivo do unban").setRequired(true)),

  new SlashCommandBuilder().setName("kick").setDescription("Kick (one-shot)")
    .addStringOption(o=>o.setName("identificador").setDescription("UserId, username ou @username").setRequired(true))
    .addStringOption(o=>o.setName("motivo").setDescription("Motivo do kick").setRequired(true)),
].map(c=>c.toJSON());

// =======================
// CLIENT
// =======================
const client = new Client({ intents:[GatewayIntentBits.Guilds] });

async function registerCommands(){
  const rest = new REST({ version:"10" }).setToken(TOKEN);
  try { await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body:commands }); console.log("✔ Slash commands registrados"); }
  catch(err){ console.error("❌ Falha ao registrar comandos:", err); }
}

client.once("ready", async ()=>{
  console.log(`✔ Online: ${client.user.tag}`);
  await registerCommands();
  setInterval(()=>sendRedeemLogIfNew(client), POLL_SECONDS*1000);
});

// =======================
// INTERAÇÕES
// =======================
client.on("interactionCreate", async interaction=>{
  if(!interaction.isChatInputCommand()) return;
  const member = interaction.member;
  const isMod = hasRole(member, ROLE_MOD_ID);
  const canGen = hasRole(member, ROLE_CODEGEN_ID);

  try {
    // ========== /gencode ==========
    if(interaction.commandName==="gencode"){
      if(!canGen) return interaction.reply({ embeds:[denyEmbed("Sem permissão","Você não tem permissão pra gerar códigos.")], ephemeral:true });
      const type = interaction.options.getString("type",true);
      const value = interaction.options.getString("value",true);
      const amount = interaction.options.getInteger("amount",true);
      if(amount<1||amount>100) return interaction.reply({ embeds:[denyEmbed("Quantidade inválida","1-100")], ephemeral:true });

      const isWeapon = WEAPONS.map(w=>w.toUpperCase()).includes(String(type).toUpperCase());
      if(isWeapon && isBlacklistedWeapon(type) && !hasRole(member,ROLE_BLACKLIST_BYPASS_ID)) return interaction.reply({ embeds:[denyEmbed("Bloqueado","Arma na blacklist.")], ephemeral:true });
      if(isWeapon && value!==true && !hasRole(member,ROLE_BLACKLIST_BYPASS_ID)) return interaction.reply({ embeds:[denyEmbed("Value inválido","Pra arma value=true")], ephemeral:true });

      await interaction.deferReply({ ephemeral:false });
      const codes = [];
      for(let i=0;i<amount;i++){
        const code = genCodeString();
        const res = await apiPost("create",{ code, type, reward:value, adminDiscord:`${interaction.user.username} (${interaction.user.id})` });
        if(!res) codes.push("❌ Falha ao gerar código"); else codes.push(code);
      }
      const emb = infoEmbed(`${amount} Código(s) gerado(s)`)
        .addFields(
          { name:"Type", value:String(type), inline:true },
          { name:"Value", value:String(value), inline:true },
          { name:"Total", value:String(amount), inline:true },
          { name:"Codes", value:codes.join("\n").slice(0,3900), inline:false }
        ).setFooter({ text:`Generated by ${interaction.user.username} (${interaction.user.id})` }).setTimestamp(new Date());
      await interaction.editReply({ embeds:[emb] });
      if(MOD_LOG_CHANNEL_ID){ const ch=await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(()=>null); if(ch) ch.send({ embeds:[emb] }).catch(()=>{}); }
      return;
    }

    // ========== /genrand ==========
    if(interaction.commandName==="genrand"){
      if(!canGen) return interaction.reply({ embeds:[denyEmbed("Sem permissão","Você não tem permissão pra gerar códigos.")], ephemeral:true });
      const amount = interaction.options.getInteger("amount",true);
      if(amount<1||amount>100) return interaction.reply({ embeds:[denyEmbed("Quantidade inválida","1-100")], ephemeral:true });
      await interaction.deferReply({ ephemeral:false });

      const pool = hasRole(member,ROLE_BLACKLIST_BYPASS_ID)?WEAPONS:WEAPONS.filter(w=>!isBlacklistedWeapon(w));
      if(pool.length===0) return interaction.editReply({ embeds:[denyEmbed("Sem pool","Nenhuma arma disponível")] });

      const codes = [];
      const picked = [];
      for(let i=0;i<amount;i++){
        const weapon=randPick(pool);
        const code=genCodeString();
        const res=await apiPost("create",{ code, type:weapon, reward:true, adminDiscord:`${interaction.user.username} (${interaction.user.id})` });
        codes.push(res?code:"❌ Falha ao gerar código"); picked.push(weapon);
      }
      const summary = picked.slice(0,12).join(", ") + (picked.length>12?"...":"");
      const emb = infoEmbed(`${amount} Código(s) aleatório(s)`)
        .addFields(
          { name:"Type", value:"Random Weapons", inline:true },
          { name:"Value", value:"true", inline:true },
          { name:"Total", value:String(amount), inline:true },
          { name:"Picked", value:summary, inline:false },
          { name:"Codes", value:codes.join("\n").slice(0,3900), inline:false }
        ).setFooter({ text:`Generated by ${interaction.user.username} (${interaction.user.id})` }).setTimestamp(new Date());
      await interaction.editReply({ embeds:[emb] });
      if(MOD_LOG_CHANNEL_ID){ const ch=await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(()=>null); if(ch) ch.send({ embeds:[emb] }).catch(()=>{}); }
      return;
    }

    // ========== /ban, /unban, /kick ==========
    if(["ban","unban","kick"].includes(interaction.commandName)){
      if(!isMod) return interaction.reply({ embeds:[denyEmbed("Sem permissão","Você não tem permissão de moderação.")], ephemeral:true });
      const identificador = interaction.options.getString("identificador",true);
      const motivo = interaction.options.getString("motivo",true);
      let durationMs; if(interaction.commandName==="ban") durationMs=parseDurationToMs(interaction.options.getString("duração",true));
      if(interaction.commandName==="ban" && durationMs===null) return interaction.reply({ embeds:[denyEmbed("Duração inválida","perma | 30m | 2h | 7d")], ephemeral:true });
      const payload = { robloxUser:identificador, reason:motivo, adminDiscord:`${interaction.user.username} (${interaction.user.id})` };
      if(interaction.commandName==="ban") payload.durationMs=durationMs;
      await apiPost(interaction.commandName,payload);

      const emb = new EmbedBuilder()
        .setTitle(interaction.commandName.charAt(0).toUpperCase()+interaction.commandName.slice(1)+" aplicado")
        .setColor(interaction.commandName==="ban"?0xED4245:interaction.commandName==="kick"?0xFEE75C:0x57F287)
        .addFields(
          { name:"Identificador", value:`\`${identificador}\``, inline:false },
          ...(interaction.commandName==="ban"?[{ name:"Duração", value:durationMs==="Permanent"?"Permanente":formatMs(durationMs), inline:true }]:[]),
          { name:"Motivo", value:motivo, inline:false },
          { name:"Moderator", value:`${interaction.user.username} (${interaction.user.id})`, inline:false }
        ).setTimestamp(new Date());
      await interaction.reply({ embeds:[emb] });
      if(MOD_LOG_CHANNEL_ID){ const ch=await client.channels.fetch(MOD_LOG_CHANNEL_ID).catch(()=>null); if(ch) ch.send({ embeds:[emb] }).catch(()=>{}); }
      return;
    }

  } catch(e){
    const emb=denyEmbed("Falha",String(e?.message||e));
    if(interaction.deferred||interaction.replied) return interaction.editReply({ embeds:[emb] }).catch(()=>{});
    return interaction.reply({ embeds:[emb], ephemeral:true }).catch(()=>{});
  }
});

client.login(TOKEN);
