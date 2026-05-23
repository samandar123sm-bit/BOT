const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname)));

const BOT_TOKEN = process.env.BOT_TOKEN || '8767223581:AAHcaekUAnascE8YnM1jaTlJzRPxbC_gNMM';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyD3wnPJzOL5jei3hfrjFZ6vD5rYOziTrKo';
const APP_URL = 'https://t.me/ZeroMaxxbot/ilovasi';
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

const OWNER_ID = '1200329840';
const GROUP_ID = '-1003511488835';

// ===================== DATABASE =====================
const DB_FILE = './db.json';

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch(e) {}
  return { users: {}, adminState: {} };
}

function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch(e) {}
}

function saveUser(from) {
  const db = loadDB();
  db.users[from.id] = {
    id: from.id,
    first_name: from.first_name || '',
    username: from.username || '',
    saved_at: new Date().toISOString()
  };
  saveDB(db);
}

function getAllUsers() {
  return Object.values(loadDB().users);
}

// ===================== PENDING STATES =====================
const pendingOrderStatus = {};
const nostockPending = {};
const broadcastPending = {};

// ===================== TELEGRAM API =====================
async function sendMessage(chat_id, text, extra = {}) {
  const body = { chat_id, text, parse_mode: 'HTML', ...extra };
  const res = await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function copyMessage(chat_id, from_chat_id, message_id) {
  const res = await fetch(`${API}/copyMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, from_chat_id, message_id })
  });
  return res.json();
}

// ===================== ZEROMAKS AI (GEMINI) =====================
async function askZeroMaksAI(userMessage, context = '') {
  const systemPrompt = `Sen ZeroMaks nomli aqlli yordamchisan. Zero Maks — Toshkentdagi mahalliy ovqat yetkazib berish xizmati.

Vazifang:
- Foydalanuvchilar savollariga do'stona, qisqa (2-3 jumla) o'zbek tilida javob ber
- Buyurtma holati so'ralsa buyurtma raqamini aniqla

MUHIM: Agar buyurtma holati so'ralsa, javobingda "BUYURTMA_HOLATI:#RAQAM" yoz.
Raqam noma'lum bo'lsa: "BUYURTMA_HOLATI:NOMALUM"

${context ? 'Qoshimcha: ' + context : ''}`;

  try {
    const res = await fetch(GEMINI_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.7 }
      })
    });
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch(e) {
    console.error('Gemini xato:', e.message);
    return null;
  }
}

async function detectBroadcastIntent(text) {
  try {
    const res = await fetch(GEMINI_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: `Foydalanuvchi xabarining niyatini aniqla. FAQAT JSON qaytар (boshqa hech narsa yozma):
{"intent":"broadcast","message":"yuboriladigan matn"} — agar barcha foydalanuvchilarga xabar yubormoqchi bolsa
{"intent":"other"} — boshqa holatlarda
Broadcast misollari: "barchaga yubor", "hammaga de", "elon qil", "xabar yubor"` }] },
        contents: [{ parts: [{ text }] }],
        generationConfig: { maxOutputTokens: 200, temperature: 0.1 }
      })
    });
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{"intent":"other"}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch(e) {
    return { intent: 'other' };
  }
}

// ===================== MAIN MENU =====================
const MAIN_MENU = {
  keyboard: [
    [{ text: '🛒 Buyurtma berish' }, { text: '📦 Buyurtmam holati' }],
    [{ text: '👨‍💻 Dasturchi bilan boglanish' }]
  ],
  resize_keyboard: true,
  persistent: true
};

// ===================== WEBHOOK =====================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const update = req.body;

  // ── CALLBACK QUERY ──
  if (update?.callback_query) {
    const cb = update.callback_query;
    const data = cb.data || '';
    const cbChatId = cb.message?.chat?.id;
    const cbMsgId = cb.message?.message_id;

    const answerCb = async (text) => {
      await fetch(`${API}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cb.id, text })
      });
    };
    const removeButtons = async () => {
      await fetch(`${API}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cbChatId, message_id: cbMsgId, reply_markup: { inline_keyboard: [] } })
      });
    };

    if (data === 'broadcast_yes') {
      const pending = broadcastPending[OWNER_ID];
      if (!pending) return;
      await answerCb('Yuborilmoqda...');
      await removeButtons();
      const users = getAllUsers();
      let success = 0, failed = 0;
      for (const user of users) {
        if (String(user.id) === OWNER_ID) { success++; continue; }
        try {
          const r = await copyMessage(user.id, pending.fromChatId, pending.messageId);
          if (r.ok) success++; else failed++;
        } catch(e) { failed++; }
        await new Promise(r => setTimeout(r, 50));
      }
      await sendMessage(OWNER_ID,
        `✅ <b>Yuborildi!</b>\n\n👥 Jami: ${users.length}\n✅ Muvaffaqiyatli: ${success}\n❌ Xato: ${failed}`,
        { reply_markup: MAIN_MENU }
      );
      delete broadcastPending[OWNER_ID];
      return;
    }

    if (data === 'broadcast_no') {
      await answerCb('Bekor qilindi');
      await removeButtons();
      delete broadcastPending[OWNER_ID];
      await sendMessage(OWNER_ID, 'Bekor qilindi.', { reply_markup: MAIN_MENU });
      return;
    }

    if (data.startsWith('nostock_')) {
      const orderNum = data.replace('nostock_', '');
      const msgText = cb.message?.text || '';
      const tgMatch = msgText.match(/ID[:\s]+([0-9]+)/);
      const tgId = tgMatch ? tgMatch[1] : null;
      nostockPending[orderNum] = { tgId };
      await answerCb('Qaysi mahsulot tugdi?');
      await removeButtons();
      await sendMessage(cbChatId,
        `<b>${orderNum}</b> — Qaysi mahsulot tugadi?\n\nShu xabarga <b>reply</b> qiling va mahsulot nomini yozing`,
        { reply_markup: { force_reply: true, selective: false } }
      );
      return;
    }
    return;
  }

  const message = update?.message;
  if (!message) return;

  const chat_id = message.chat.id;
  const from = message.from;
  const text = message.text || '';
  const isOwner = String(chat_id) === OWNER_ID;
  const isGroup = String(chat_id) === GROUP_ID;

  if (!isGroup) saveUser(from);

  // ── GURUH ICHIDA REPLY ──
  if (isGroup && message.reply_to_message) {
    const replyText = message.reply_to_message.text || '';

    const nostockMatch = replyText.match(/<b>(#[\S]+)<\/b> — Qaysi mahsulot tugadi/);
    if (nostockMatch) {
      const orderNum = nostockMatch[1];
      const productName = text.trim();
      const pending = nostockPending[orderNum];
      if (pending?.tgId && productName) {
        await sendMessage(pending.tgId,
          `😔 Kechirasiz, <b>${orderNum}</b> buyurtmangizdagi <b>${productName}</b> tugagan.\n\n+998990041166 ga murojaat qilib almashtiring yoki pulingizni qaytaring.`
        );
        await sendMessage(GROUP_ID, `✅ Mijozga yuborildi: "${productName}" tugagan — ${orderNum}`);
        delete nostockPending[orderNum];
      }
      return;
    }

    const orderStatusMatch = replyText.match(/📦 <b>(#[\S]+)<\/b> buyurtma holati qanday/);
    if (orderStatusMatch) {
      const orderNum = orderStatusMatch[1];
      const pending = pendingOrderStatus[orderNum];
      const adminReply = text.trim();
      if (pending?.userId && adminReply) {
        const aiReply = await askZeroMaksAI(
          `Admin aytdi: "${adminReply}". ${orderNum} buyurtma haqida foydalanuvchiga chiroyli xabar yoz. BUYURTMA_HOLATI tagini ishlatma.`
        );
        const finalMsg = (aiReply && !aiReply.includes('BUYURTMA_HOLATI:'))
          ? aiReply
          : `📦 <b>${orderNum}</b> buyurtmangiz holati:\n\n${adminReply}`;
        await sendMessage(pending.userId, finalMsg, { reply_markup: MAIN_MENU });
        await sendMessage(GROUP_ID, `✅ ${pending.firstName} ga javob yuborildi.`);
        delete pendingOrderStatus[orderNum];
      }
      return;
    }
    return;
  }

  // ── BOT EGASI ──
  if (isOwner) {
    const intent = await detectBroadcastIntent(text);
    if (intent?.intent === 'broadcast' && intent?.message) {
      broadcastPending[OWNER_ID] = { fromChatId: chat_id, messageId: message.message_id };
      const users = getAllUsers();
      await sendMessage(OWNER_ID,
        `📢 <b>Broadcast</b>\n\nYuboriladigan xabar:\n\n"${intent.message}"\n\n👥 Foydalanuvchilar: ${users.length} ta\n\nYuborilaymi?`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Ha, yubor', callback_data: 'broadcast_yes' },
              { text: '❌ Bekor', callback_data: 'broadcast_no' }
            ]]
          }
        }
      );
      return;
    }
    const aiReply = await askZeroMaksAI(text, 'Bu bot egasi.');
    await sendMessage(OWNER_ID, aiReply || 'AI hozirda ishlamaydi.', { reply_markup: MAIN_MENU });
    return;
  }

  // ── ODDIY FOYDALANUVCHI ──

  if (text === '/start' || text.startsWith('/start ')) {
    await sendMessage(chat_id,
      `Assalomu alaykum, <b>${from.first_name || 'do\'st'}!</b>\n\nMen <b>ZeroMaks AI</b> yordamchisiman! Buyurtma, menyu va har qanday savol bo'yicha yordam beraman 🍕`,
      { reply_markup: { inline_keyboard: [[{ text: '🛒 Ilovani ochish', web_app: { url: APP_URL } }]] } }
    );
    await sendMessage(chat_id, 'Quyidagi menyudan foydalaning:', { reply_markup: MAIN_MENU });
    return;
  }

  if (text === '🛒 Buyurtma berish') {
    await sendMessage(chat_id, 'Buyurtma berish uchun ilovani oching:', {
      reply_markup: { inline_keyboard: [[{ text: '🛒 Ilovani ochish', web_app: { url: APP_URL } }]] }
    });
    return;
  }

  if (text === '📦 Buyurtmam holati') {
    await sendMessage(chat_id, 'Buyurtma raqamingizni yozing (masalan: #12345678)', { reply_markup: MAIN_MENU });
    return;
  }

  if (text === '👨‍💻 Dasturchi bilan boglanish') {
    await sendMessage(chat_id, '👨‍💻 <b>Dasturchi:</b> @xwSamandar', { reply_markup: MAIN_MENU });
    return;
  }

  // ── ZEROMAKS AI ──
  const aiResponse = await askZeroMaksAI(text);

  if (!aiResponse) {
    await sendMessage(chat_id, 'Hozirda javob bera olmayapman. Keyinroq urinib koring.', { reply_markup: MAIN_MENU });
    return;
  }

  if (aiResponse.includes('BUYURTMA_HOLATI:')) {
    const match = aiResponse.match(/BUYURTMA_HOLATI:(#[\S]+|NOMALUM)/);
    const orderNum = match?.[1];

    if (orderNum && orderNum !== 'NOMALUM') {
      pendingOrderStatus[orderNum] = { userId: chat_id, firstName: from.first_name || 'Foydalanuvchi' };
      await sendMessage(GROUP_ID,
        `📦 <b>${orderNum}</b> buyurtma holati qanday?\n\n👤 ${from.first_name || ''} (ID: ${chat_id})\n\nShu xabarga <b>reply</b> qilib holat yozing`,
        { reply_markup: { force_reply: true, selective: false } }
      );
      await sendMessage(chat_id,
        `🔍 <b>${orderNum}</b> holati so'raldi. Admin tez orada javob beradi! ⏳`,
        { reply_markup: MAIN_MENU }
      );
    } else {
      await sendMessage(chat_id, 'Buyurtma raqamingizni yozing (masalan: #12345678)', { reply_markup: MAIN_MENU });
    }
    return;
  }

  await sendMessage(chat_id, aiResponse, { reply_markup: MAIN_MENU });
});

app.get('/health', (req, res) => res.send('Zero Maks Bot ishlayapti'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server port ${PORT} da ishga tushdi`));
