const qrcode = require("qrcode-terminal");
const { Client, MessageMedia, LocalAuth } = require("whatsapp-web.js");

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: false,
    args: [
      "--no-sandbox", 
      "--disable-setuid-sandbox"],
  },
});

// QR CODE
client.on("qr", (qr) => {
  console.log("📲 Escaneie o QR Code abaixo:");
  qrcode.generate(qr, { small: true });
});

// WHATSAPP CONECTADO
client.on("ready", () => {
  console.log("✅ Tudo certo! WhatsApp conectado.");
});

// DESCONEXÃO
client.on("disconnected", (reason) => {
  console.log("⚠️ Desconectado:", reason);
});

client.initialize();

// DELAY
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Função artificial de digitação
async function typing(chat) {
  await delay(1200);
  await chat.sendStateTyping();
  await delay(1200);
}

// -------------------------------------------------------------------
// 🔥 menu 
// -------------------------------------------------------------------
async function processarMenu(opcao, msg, chat) {

  switch (opcao) {

    // 1️⃣ FALAR COM ATENDENTE
    case "1":
      await typing(chat);
      await msg.reply(
        "👨‍💼 Certo! Vou te encaminhar para um atendente humano.\n" +
        "Aguarde um instante..."
      );

      // EM ANDAMENTO FAZER, integrar com banco de dados, API, aviso ao atendente etc.
      break;

    // 2️⃣ HORÁRIO DE ATENDIMENTO
    case "2":
      await typing(chat);
      await msg.reply(
        "⏰ *Horário de Atendimento:*\n\n" +
        "Segunda a Sexta: *08h às 18h*\n" +
        "Sábado: *09h às 13h*\n" +
        "Domingos e feriados: *Fechado*\n\n" +
        "Digite 'menu' para retornar."
      );

      // AJUSTARR!!!
      break;

    // 3️⃣ LOCALIZAÇÃO
    case "3":
      await typing(chat);
      await msg.reply(
        "📍 *Estamos localizados em:*\n" +
        "Rua Exemplo, 123 - Centro - Curitiba/PR\n\n" +
        "🌐 Google Maps:\nhttps://maps.google.com/?q=-25.429,-49.271"
      );
      
      // AJUSTARR!!!
      break;

    // ❌ OPÇÃO INVÁLIDA
    default:
      await typing(chat);
      await msg.reply("❌ Opção inválida.\nDigite *menu* para ver as opções.");
      break;
  }
}

// -------------------------------------------------------------------
// 📩 RECEBIMENTO DE MENSAGENS!!
// -------------------------------------------------------------------
client.on("message", async (msg) => {
  try {

    if (!msg.from || msg.from.endsWith("@g.us")) return;

    const chat = await msg.getChat();
    if (chat.isGroup) return;

    const texto = msg.body?.trim().toLowerCase() || "";

    // --------------------------------------------
    // 🏁 MENSAGEM INICIAL + MENU
    // --------------------------------------------
    if (/^(menu|oi|olá|ola|bom dia|boa tarde|boa noite)$/i.test(texto)) {
      
      await typing(chat);

      const hora = new Date().getHours();
      let saudacao = "Olá";

      if (hora >= 5 && hora < 12) saudacao = "Bom dia";
      else if (hora >= 12 && hora < 18) saudacao = "Boa tarde";
      else saudacao = "Boa noite";

      await msg.reply(
        '${saudacao}! 👋\n\n' +
        'Como posso ajudar?\n\n' +
        '*1️⃣ - Falar com atendente*\n' +
        '*2️⃣ - Horário de atendimento*\n' +
        '*3️⃣ - Localização*\n\n' +
        'Digite o número da opção desejada.'
      );

      return;
    }

    // --------------------------------------------
    // 🎯 PROCESSAMENTO DO MENU VIA SWITCH // TESTAR EM CASA 
    // --------------------------------------------
    if (/^[1-9]$/.test(texto)) {
      await processarMenu(texto, msg, chat);
      return;
    }

    // --------------------------------------------
    // 🔁 RESPOSTA PADRÃO
    // --------------------------------------------
    if (texto.length > 0) {
      await typing(chat);
      await msg.reply("Não entendi 🤔\nDigite *menu* para ver as opções.");
    }

  } catch (error) {
    console.error("Erro no processamento da mensagem:", error);
  }
});