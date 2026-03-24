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
app.get("/", (req, res) => {
  res.send("Bot online");
});

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

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !API_BASE || !API_KEY) {
  console.error("Faltou configurar ENV.");
  process.exit(1);
}

// =====================
// UTILS
// =====================
function denyEmbed(title, desc) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setColor(0xFF5555);
}

function okEmbed(title, desc) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setColor(0x55FF7F);
}

// =====================
// API
// =====================
async function apiPost(endpoint, body) {
  const res = await fetch(`${API_BASE}/api/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(json?.message || "Erro API");
  }

  return json;
}

// =====================
// COMMANDS
// =====================
const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Testa o bot"),

  new SlashCommandBuilder()
    .setName("gencode")
    .setDescription("Gerar código")
    .addStringOption(o => o.setName("type").setRequired(true))
    .addStringOption(o => o.setName("value").setRequired(true))
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });
  console.log("✔ Comandos registrados");
}

// =====================
// CLIENT
// =====================
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", async () => {
  console.log(`✔ Online: ${client.user.tag}`);
  await registerCommands();
});

// =====================
// INTERAÇÕES
// =====================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "ping") {
      return interaction.reply({ content: "🏓 Pong!" });
    }

    if (interaction.commandName === "gencode") {
      const type = interaction.options.getString("type");
      const value = interaction.options.getString("value");

      await apiPost("create", {
        code: Math.random().toString(36).substring(2, 10).toUpperCase(),
        type,
        reward: value,
        adminDiscord: interaction.user.username
      });

      return interaction.reply({
        embeds: [okEmbed("Sucesso", "Código criado")]
      });
    }

  } catch (err) {
    return interaction.reply({
      embeds: [denyEmbed("Erro", String(err.message))]
    });
  }
});

client.login(TOKEN);
