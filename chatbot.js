const qrcode = require("qrcode-terminal");
const moment = require("moment-timezone");
const { Client, LocalAuth } = require("whatsapp-web.js");

const BOT_CONFIG = {
  companyName: "Atendimento Exemplo",
  timezone: "America/Sao_Paulo",
  address: "Rua Exemplo, 123 - Centro - Curitiba/PR",
  mapLink: "https://maps.google.com/?q=-25.429,-49.271",
  inactivityResetMinutes: 60,
  typingDelayMs: 900,
  businessHours: {
    weekdays: { start: 8, end: 18 },
    saturday: { start: 9, end: 13 },
  },
  guardrails: {
    maxCharsPerMessage: 600,
    maxInvalidAttempts: 4,
    spamWindowMs: 15 * 1000,
    spamMaxMessagesInWindow: 6,
    cooldownMinutes: 5,
  },
};

const MENU_TEXT = [
  "Como posso ajudar?",
  "",
  "1 - Falar com atendente",
  "2 - Horario de atendimento",
  "3 - Localizacao",
  "4 - Duvidas frequentes (FAQ)",
  "5 - Abrir solicitação",
  "",
  "Digite o numero da opcao desejada.",
  "Comandos: menu | voltar | sair",
].join("\n");

const FAQ_TEXT = [
  "FAQ rapido:",
  "a - Formas de pagamento",
  "b - Prazo de entrega",
  "c - Trocas e devolucoes",
  "",
  "Digite a, b ou c.",
].join("\n");

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: String(process.env.HEADLESS || "false") === "true",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

const sessions = new Map();
const blockedUntil = new Map();

const SENSITIVE_PATTERNS = [
  /\b(?:senha|password|token|codigo de seguranca|cvv)\b/i,
  /\b(?:cartao|numero do cartao)\b/i,
];

const ABUSIVE_PATTERNS = [
  /\b(?:otario|idiota|burro|fdp|arrombado|lixo)\b/i,
  /\b(?:vai tomar no cu|vsf|foda-se)\b/i,
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function typing(chat) {
  await delay(BOT_CONFIG.typingDelayMs);
  await chat.sendStateTyping();
  await delay(BOT_CONFIG.typingDelayMs);
}

function normalizeText(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      state: "MAIN_MENU",
      handoff: false,
      lastInteractionAt: Date.now(),
      ticketDraft: null,
      customerName: null,
      invalidAttempts: 0,
      spamHits: [],
    });
  }

  const session = sessions.get(userId);
  session.lastInteractionAt = Date.now();
  return session;
}

function resetSession(session) {
  session.state = "MAIN_MENU";
  session.handoff = false;
  session.ticketDraft = null;
  session.invalidAttempts = 0;
}

function isBlocked(userId) {
  const until = blockedUntil.get(userId);
  return Boolean(until && Date.now() < until);
}

function blockUser(userId, minutes) {
  blockedUntil.set(userId, Date.now() + minutes * 60 * 1000);
}

function getRemainingBlockMinutes(userId) {
  const until = blockedUntil.get(userId);
  if (!until) return 0;
  const remainingMs = Math.max(0, until - Date.now());
  return Math.ceil(remainingMs / (60 * 1000));
}

function containsPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function exceedsSpamThreshold(session) {
  const now = Date.now();
  session.spamHits = (session.spamHits || []).filter(
    (timestamp) => now - timestamp <= BOT_CONFIG.guardrails.spamWindowMs
  );
  session.spamHits.push(now);
  return session.spamHits.length > BOT_CONFIG.guardrails.spamMaxMessagesInWindow;
}

function markInvalidAttempt(session) {
  session.invalidAttempts = (session.invalidAttempts || 0) + 1;
  return session.invalidAttempts >= BOT_CONFIG.guardrails.maxInvalidAttempts;
}

function clearInvalidAttempts(session) {
  session.invalidAttempts = 0;
}

function getGreeting() {
  const hour = moment().tz(BOT_CONFIG.timezone).hour();
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

function getBusinessStatus() {
  const now = moment().tz(BOT_CONFIG.timezone);
  const day = now.day();
  const hour = now.hour();

  const weekdayStart = BOT_CONFIG.businessHours.weekdays.start;
  const weekdayEnd = BOT_CONFIG.businessHours.weekdays.end;
  const saturdayStart = BOT_CONFIG.businessHours.saturday.start;
  const saturdayEnd = BOT_CONFIG.businessHours.saturday.end;

  const isWeekday = day >= 1 && day <= 5;
  const isSaturday = day === 6;

  if (isWeekday && hour >= weekdayStart && hour < weekdayEnd) {
    return {
      open: true,
      text: "Estamos abertos agora.",
    };
  }

  if (isSaturday && hour >= saturdayStart && hour < saturdayEnd) {
    return {
      open: true,
      text: "Estamos abertos agora.",
    };
  }

  let next = now.clone();

  if (isWeekday && hour < weekdayStart) {
    next.hour(weekdayStart).minute(0).second(0);
  } else if (isWeekday && hour >= weekdayEnd) {
    next.add(1, "day").hour(weekdayStart).minute(0).second(0);
  } else if (isSaturday && hour < saturdayStart) {
    next.hour(saturdayStart).minute(0).second(0);
  } else {
    next.add(1, "day").hour(weekdayStart).minute(0).second(0);
    while (next.day() === 0) {
      next.add(1, "day");
    }
  }

  return {
    open: false,
    text: `No momento estamos fechados. Proxima abertura: ${next.format("DD/MM HH:mm")}.`,
  };
}

function buildTicketProtocol() {
  const stamp = moment().format("YYMMDDHHmmss");
  const rand = Math.floor(100 + Math.random() * 900);
  return `SOL-${stamp}-${rand}`;
}

async function sendMainMenu(msg, chat, includeGreeting = false) {
  await typing(chat);

  const greetingPrefix = includeGreeting
    ? `${getGreeting()}! Eu sou o assistente virtual da ${BOT_CONFIG.companyName}.\n\n`
    : "";

  await msg.reply(`${greetingPrefix}${MENU_TEXT}`);
}

async function notifyAdminHandoff(msg) {
  const adminNumber = (process.env.ADMIN_NUMBER || "").trim();
  if (!adminNumber) return;

  const chatId = adminNumber.includes("@c.us") ? adminNumber : `${adminNumber}@c.us`;
  const customer = msg.from.replace("@c.us", "");
  const text = `Novo pedido de atendimento humano: ${customer}`;

  try {
    await client.sendMessage(chatId, text);
  } catch (error) {
    console.error("Falha ao notificar ADMIN_NUMBER:", error.message);
  }
}

async function processFaqOption(option, msg, chat, session) {
  switch (option) {
    case "a":
      await typing(chat);
      await msg.reply(
        [
          "Formas de pagamento:",
          "- Pix",
          "- Cartao de credito em ate 3x",
          "- Boleto bancario",
          "",
          "Digite *voltar* para retornar ao menu.",
        ].join("\n")
      );
      return;
    case "b":
      await typing(chat);
      await msg.reply(
        [
          "Prazo de entrega:",
          "- Capital: 1 a 3 dias uteis",
          "- Interior: 3 a 7 dias uteis",
          "",
          "O prazo final aparece no fechamento do pedido.",
        ].join("\n")
      );
      return;
    case "c":
      await typing(chat);
      await msg.reply(
        [
          "Trocas e devolucoes:",
          "- Prazo de ate 7 dias corridos",
          "- Produto sem sinais de uso",
          "- Comprovante de compra obrigatorio",
          "",
          "Se quiser, digite *5* para abrir solicitacao.",
        ].join("\n")
      );
      return;
    default:
      await typing(chat);
      await msg.reply("Opcao invalida no FAQ. Digite a, b, c ou *voltar*.");
      session.state = "FAQ_MENU";
  }
}

async function processMainMenu(option, msg, chat, session) {
  switch (option) {
    case "1":
      session.handoff = true;
      session.state = "HUMAN_QUEUE";
      await typing(chat);
      await msg.reply(
        [
          "Perfeito, vou te encaminhar para um atendente humano.",
          "Nosso time vai continuar por aqui assim que possivel.",
          "",
          "Se quiser voltar para o bot, digite *menu*.",
        ].join("\n")
      );
      await notifyAdminHandoff(msg);
      return;

    case "2": {
      const status = getBusinessStatus();
      await typing(chat);
      await msg.reply(
        [
          "Horario de atendimento:",
          "- Segunda a Sexta: 08h as 18h",
          "- Sabado: 09h as 13h",
          "- Domingo e feriados: fechado",
          "",
          status.text,
        ].join("\n")
      );
      return;
    }

    case "3":
      await typing(chat);
      await msg.reply(
        [
          `Estamos localizados em: ${BOT_CONFIG.address}`,
          "",
          `Google Maps: ${BOT_CONFIG.mapLink}`,
        ].join("\n")
      );
      return;

    case "4":
      session.state = "FAQ_MENU";
      await typing(chat);
      await msg.reply(FAQ_TEXT);
      return;

    case "5":
      session.state = "TICKET_NAME";
      session.ticketDraft = {};
      await typing(chat);
      await msg.reply(
        "Vamos abrir sua solicitacao. Primeiro, me diga seu nome completo."
      );
      return;

    default:
      await typing(chat);
      await msg.reply("Opcao invalida. Digite *menu* para ver as opcoes.");
  }
}

async function processTicketFlow(msg, chat, session, inputText) {
  if (session.state === "TICKET_NAME") {
    session.customerName = inputText;
    session.state = "TICKET_SUBJECT";

    await typing(chat);
    await msg.reply("Obrigado! Agora descreva em poucas palavras o assunto da solicitacao.");
    return;
  }

  if (session.state === "TICKET_SUBJECT") {
    session.ticketDraft = {
      customerName: session.customerName || "Nao informado",
      subject: inputText,
      createdAt: moment().tz(BOT_CONFIG.timezone).format("DD/MM/YYYY HH:mm"),
      protocol: buildTicketProtocol(),
    };

    session.state = "TICKET_CONFIRM";

    await typing(chat);
    await msg.reply(
      [
        "Confere os dados da sua solicitacao:",
        `- Nome: ${session.ticketDraft.customerName}`,
        `- Assunto: ${session.ticketDraft.subject}`,
        `- Protocolo: ${session.ticketDraft.protocol}`,
        "",
        "Digite *confirmar* para finalizar ou *voltar* para cancelar.",
      ].join("\n")
    );
    return;
  }

  if (session.state === "TICKET_CONFIRM") {
    if (inputText === "confirmar") {
      const protocol = session.ticketDraft?.protocol || buildTicketProtocol();
      await typing(chat);
      await msg.reply(
        [
          `Solicitacao registrada com sucesso! Protocolo: ${protocol}`,
          "Guarde esse numero para acompanhar com o atendente.",
          "",
          "Digite *menu* para continuar.",
        ].join("\n")
      );
      resetSession(session);
      return;
    }

    await typing(chat);
    await msg.reply("Para finalizar, digite *confirmar*. Se quiser cancelar, digite *voltar*.");
  }
}

function shouldResetByInactivity(session) {
  const minutesInactive = (Date.now() - session.lastInteractionAt) / (1000 * 60);
  return minutesInactive >= BOT_CONFIG.inactivityResetMinutes;
}

setInterval(() => {
  const now = Date.now();

  for (const [userId, session] of sessions.entries()) {
    if (shouldResetByInactivity(session)) {
      sessions.delete(userId);
    }
  }

  for (const [userId, until] of blockedUntil.entries()) {
    if (now >= until) {
      blockedUntil.delete(userId);
    }
  }
}, 10 * 60 * 1000);

client.on("qr", (qr) => {
  console.log("Escaneie o QR Code abaixo:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("WhatsApp conectado com sucesso.");
});

client.on("auth_failure", (message) => {
  console.error("Falha de autenticacao:", message);
});

client.on("disconnected", (reason) => {
  console.log("Bot desconectado:", reason);
});

client.on("message", async (msg) => {
  try {
    if (!msg.from || msg.from === "status@broadcast" || msg.from.endsWith("@g.us")) {
      return;
    }

    const chat = await msg.getChat();
    if (chat.isGroup) return;

    const session = getSession(msg.from);
    const rawText = (msg.body || "").trim();
    const text = normalizeText(rawText);

    if (isBlocked(msg.from)) {
      const remaining = getRemainingBlockMinutes(msg.from);
      await typing(chat);
      await msg.reply(
        `Seu atendimento foi pausado temporariamente por seguranca. Tente novamente em ${remaining} minuto(s).`
      );
      return;
    }

    if (!text && msg.hasMedia) {
      await typing(chat);
      await msg.reply("Recebi sua midia. Se puder, envie tambem uma mensagem com contexto.");
      return;
    }

    if (rawText.length > BOT_CONFIG.guardrails.maxCharsPerMessage) {
      await typing(chat);
      await msg.reply(
        `Mensagem muito longa. Envie em partes de ate ${BOT_CONFIG.guardrails.maxCharsPerMessage} caracteres.`
      );
      return;
    }

    if (exceedsSpamThreshold(session)) {
      blockUser(msg.from, BOT_CONFIG.guardrails.cooldownMinutes);
      await typing(chat);
      await msg.reply(
        "Detectei muitas mensagens em pouco tempo. Vou pausar por alguns minutos para proteger o atendimento."
      );
      return;
    }

    if (containsPattern(text, ABUSIVE_PATTERNS)) {
      blockUser(msg.from, BOT_CONFIG.guardrails.cooldownMinutes);
      await typing(chat);
      await msg.reply(
        "Para continuar, mantenha uma linguagem respeitosa. Atendimento pausado temporariamente."
      );
      return;
    }

    if (containsPattern(text, SENSITIVE_PATTERNS)) {
      await typing(chat);
      await msg.reply(
        "Por seguranca, nao compartilhe senha, CVV, token ou dados completos de cartao por aqui."
      );
      return;
    }

    const isGreeting = ["oi", "ola", "bom dia", "boa tarde", "boa noite", "menu", "inicio"].includes(text);

    if (isGreeting) {
      resetSession(session);
      await sendMainMenu(msg, chat, true);
      return;
    }

    if (text === "sair" || text === "encerrar") {
      resetSession(session);
      await typing(chat);
      await msg.reply("Conversa encerrada por aqui. Quando quiser, digite *menu*.");
      return;
    }

    if (text === "voltar") {
      if (session.state === "FAQ_MENU") {
        session.state = "MAIN_MENU";
        clearInvalidAttempts(session);
        await sendMainMenu(msg, chat);
        return;
      }

      if (["TICKET_NAME", "TICKET_SUBJECT", "TICKET_CONFIRM"].includes(session.state)) {
        resetSession(session);
        await typing(chat);
        await msg.reply("Solicitacao cancelada. Digite *menu* para ver outras opcoes.");
        return;
      }

      if (session.state === "HUMAN_QUEUE") {
        session.handoff = false;
        session.state = "MAIN_MENU";
        clearInvalidAttempts(session);
        await sendMainMenu(msg, chat);
        return;
      }

      clearInvalidAttempts(session);
      await sendMainMenu(msg, chat);
      return;
    }

    if (session.handoff && session.state === "HUMAN_QUEUE") {
      await typing(chat);
      await msg.reply("Voce esta na fila de atendimento humano. Digite *menu* para voltar ao bot.");
      return;
    }

    if (session.state === "FAQ_MENU") {
      clearInvalidAttempts(session);
      await processFaqOption(text, msg, chat, session);
      return;
    }

    if (["TICKET_NAME", "TICKET_SUBJECT", "TICKET_CONFIRM"].includes(session.state)) {
      clearInvalidAttempts(session);
      await processTicketFlow(msg, chat, session, rawText);
      return;
    }

    if (/^[1-5]$/.test(text)) {
      clearInvalidAttempts(session);
      await processMainMenu(text, msg, chat, session);
      return;
    }

    if (text.length > 0) {
      const reachedLimit = markInvalidAttempt(session);

      if (reachedLimit) {
        blockUser(msg.from, BOT_CONFIG.guardrails.cooldownMinutes);
        resetSession(session);
        await typing(chat);
        await msg.reply(
          "Muitas tentativas invalidas seguidas. Atendimento pausado por alguns minutos para seguranca."
        );
        return;
      }

      await typing(chat);
      await msg.reply(
        "Nao consegui identificar sua solicitacao. Digite *menu* para ver as opcoes de atendimento."
      );
    }
  } catch (error) {
    console.error("Erro no processamento da mensagem:", error);
  }
});

client.initialize();

