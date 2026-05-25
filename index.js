const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const BOT_TOKEN = process.env.BOT_TOKEN || '8767223581:AAHcaekUAnascE8YnM1jaTlJzRPxbC_gNMM';
const APP_URL = 'https://t.me/ZeroMaxxbot/ilovasi';
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const OWNER_ID = '1200329840';
const GROUP_ID = '-1003511488835';

// ===================== DATABASE =====================
const DB_FILE = './db.json';

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch(e) {}
  return { users: {} };
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
const nostockPending = {};    // { orderNum: { tgId, chatId, messageId } }
const broadcastPending = {};  // { ownerId: { fromChatId, messageId } }

// ===================== TELEGRAM API =====================
async function sendMessage(chat_id, text, extra = {}) {
  const res = await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', ...extra })
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

async function answerCallback(callback_query_id, text = '') {
  await fetch(`${API}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id, text })
  });
}

async function removeInlineButtons(chat_id, message_id) {
  await fetch(`${API}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, message_id, reply_markup: { inline_keyboard: [] } })
  });
}

// Mijozga status xabari
const STATUS_MESSAGES = {
  confirmed: (num) => `✅ Buyurtmangiz ${num} tasdiqlandi! Tayyorlanmoqda 👨‍🍳`,
  rejected:  (num) => `❌ Afsuski, buyurtmangiz ${num} rad etildi. +998990041166 ga murojaat qiling.`,
};

// ===================== MAIN MENU =====================
const MAIN_MENU = {
  keyboard: [
    [{ text: '🛒 Buyurtma berish' }],
    [{ text: '📦 Buyurtmam holati' }, { text: '📞 Bog\'lanish' }]
  ],
  resize_keyboard: true,
  persistent: true
};

// ===================== WEBHOOK =====================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const update = req.body;

  // ── CALLBACK QUERY (inline tugmalar) ──
  if (update?.callback_query) {
    const cb = update.callback_query;
    const data = cb.data || '';
    const cbChatId = cb.message?.chat?.id;
    const cbMsgId  = cb.message?.message_id;

    // ── ✅ Tasdiqlash (karta to'lov) ──
    if (data.startsWith('pay_ok_')) {
      const orderNum = data.replace('pay_ok_', '');
      await answerCallback(cb.id, '✅ Tasdiqlandi!');
      await removeInlineButtons(cbChatId, cbMsgId);

      // Guruhga tasdiq
      await sendMessage(cbChatId, `✅ <b>${orderNum}</b> tasdiqlandi! Tayyorlanmoqda 👨‍🍳`);

      // Mijozga xabar
      const msgText = cb.message?.caption || cb.message?.text || '';
      const tgMatch = msgText.match(/Telegram ID[:\s]+([0-9]+)/);
      const tgId = tgMatch ? tgMatch[1] : null;
      if (tgId) {
        await sendMessage(tgId, STATUS_MESSAGES.confirmed(orderNum));
      }
      return;
    }

    // ── ❌ Rad etish (karta to'lov) ──
    if (data.startsWith('pay_rej_')) {
      const orderNum = data.replace('pay_rej_', '');
      await answerCallback(cb.id, '❌ Rad etildi');
      await removeInlineButtons(cbChatId, cbMsgId);

      // Guruhga
      await sendMessage(cbChatId, `❌ <b>${orderNum}</b> rad etildi.`);

      // Mijozga
      const msgText = cb.message?.caption || cb.message?.text || '';
      const tgMatch = msgText.match(/Telegram ID[:\s]+([0-9]+)/);
      const tgId = tgMatch ? tgMatch[1] : null;
      if (tgId) {
        await sendMessage(tgId, STATUS_MESSAGES.rejected(orderNum));
      }
      return;
    }

    // ── 😔 Tovar tugagan ──
    if (data.startsWith('nostock_')) {
      const orderNum = data.replace('nostock_', '');
      const msgText = cb.message?.text || '';
      const tgMatch = msgText.match(/Telegram ID[:\s]+([0-9]+)/);
      const tgId = tgMatch ? tgMatch[1] : null;

      nostockPending[orderNum] = { tgId, chatId: cbChatId, messageId: cbMsgId };

      await answerCallback(cb.id, 'Qaysi mahsulot tugdi?');
      await removeInlineButtons(cbChatId, cbMsgId);
      await sendMessage(cbChatId,
        `😔 <b>${orderNum}</b> — Qaysi mahsulot tugadi?\n\nShu xabarga <b>reply</b> qilib mahsulot nomini yozing 👇`,
        { reply_markup: { force_reply: true, selective: false } }
      );
      return;
    }

    // ── Broadcast ha/yo'q ──
    if (data === 'broadcast_yes') {
      const pending = broadcastPending[OWNER_ID];
      if (!pending) return;
      await answerCallback(cb.id, 'Yuborilmoqda...');
      await removeInlineButtons(cbChatId, cbMsgId);
      const users = getAllUsers();
      let ok = 0, fail = 0;
      for (const user of users) {
        if (String(user.id) === OWNER_ID) { ok++; continue; }
        try {
          const r = await copyMessage(user.id, pending.fromChatId, pending.messageId);
          if (r.ok) ok++; else fail++;
        } catch(e) { fail++; }
        await new Promise(r => setTimeout(r, 50));
      }
      await sendMessage(OWNER_ID,
        `✅ <b>Yuborildi!</b>\n\n👥 Jami: ${users.length}\n✅ Muvaffaqiyatli: ${ok}\n❌ Xato: ${fail}`,
        { reply_markup: MAIN_MENU }
      );
      delete broadcastPending[OWNER_ID];
      return;
    }

    if (data === 'broadcast_no') {
      await answerCallback(cb.id, 'Bekor qilindi');
      await removeInlineButtons(cbChatId, cbMsgId);
      delete broadcastPending[OWNER_ID];
      await sendMessage(OWNER_ID, '↩️ Bekor qilindi.', { reply_markup: MAIN_MENU });
      return;
    }

    return;
  }

  // ── MESSAGE ──
  const message = update?.message;
  if (!message) return;

  const chat_id = message.chat.id;
  const from    = message.from;
  const text    = message.text || '';
  const isOwner = String(chat_id) === OWNER_ID;
  const isGroup = String(chat_id) === GROUP_ID;

  if (!isGroup) saveUser(from);

  // ── GURUH: admin reply qildi (nostock) ──
  if (isGroup && message.reply_to_message) {
    const replyText = message.reply_to_message.text || '';
    const nostockMatch = replyText.match(/😔 <b>(#[\S]+)<\/b> — Qaysi mahsulot tugadi/);
    if (nostockMatch) {
      const orderNum   = nostockMatch[1];
      const productName = text.trim();
      const pending    = nostockPending[orderNum];
      if (pending?.tgId && productName) {
        await sendMessage(pending.tgId,
          `😔 Kechirasiz, <b>${orderNum}</b> buyurtmangizdagi <b>${productName}</b> tugagan.\n\n+998990041166 ga murojaat qilib almashtiring yoki pulingizni qaytaring.`
        );
        await sendMessage(GROUP_ID, `✅ Mijozga yuborildi: "${productName}" tugagan — ${orderNum}`);
        delete nostockPending[orderNum];
      }
      return;
    }
    return;
  }

  // ── BOT EGASI ──
  if (isOwner) {
    const lower = text.toLowerCase();
    const isBroadcast = lower.includes('barchaga') || lower.includes('hammaga') ||
                        lower.includes('elon') || lower.includes('xabar yubor') ||
                        lower.includes('yuborish');

    if (isBroadcast) {
      broadcastPending[OWNER_ID] = { fromChatId: chat_id, messageId: message.message_id };
      const users = getAllUsers();
      await sendMessage(OWNER_ID,
        `📢 <b>Broadcast</b>\n\nYuboriladigan xabar yuqorida ko'rinmoqda.\n\n👥 Foydalanuvchilar: ${users.length} ta\n\nYuborilaymi?`,
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

    await sendMessage(OWNER_ID,
      `👋 Salom, <b>Zero Maks</b> egasi!\n\nBarchaga xabar yuborish uchun xabar yozing va "barchaga yubor" deb qo'shing.`,
      { reply_markup: MAIN_MENU }
    );
    return;
  }

  // ── ODDIY FOYDALANUVCHI ──

  if (text === '/start' || text.startsWith('/start ')) {
    await sendMessage(chat_id,
      `👋 Assalomu alaykum, <b>${from.first_name || 'do\'st'}!</b>\n\n🍕 <b>Zero Maks</b> ga xush kelibsiz!\n\nTez va qulay ovqat buyurtma qilish uchun ilovamizga kiring 👇`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '🛒 Ilovamizga kiring', web_app: { url: APP_URL } }
          ]]
        }
      }
    );
    await sendMessage(chat_id, 'Quyidagi tugmalardan foydalaning:', { reply_markup: MAIN_MENU });
    return;
  }

  if (text === '🛒 Buyurtma berish') {
    await sendMessage(chat_id,
      '🛒 Buyurtma berish uchun ilovamizni oching:',
      { reply_markup: { inline_keyboard: [[{ text: '🛒 Ilovamizga kiring', web_app: { url: APP_URL } }]] } }
    );
    return;
  }

  if (text === '📦 Buyurtmam holati') {
    await sendMessage(chat_id,
      '📦 Buyurtma holati haqida ma\'lumot olish uchun:\n\n📞 <b>+998990041166</b> ga murojaat qiling yoki buyurtma raqamingizni yozing.',
      { reply_markup: MAIN_MENU }
    );
    return;
  }

  if (text === '📞 Bog\'lanish') {
    await sendMessage(chat_id,
      '📞 <b>Telefon:</b> +998990041166\n👨‍💻 <b>Dasturchi:</b> @xwSamandar',
      { reply_markup: MAIN_MENU }
    );
    return;
  }

  // Boshqa xabarlar
  await sendMessage(chat_id,
    '🛒 Buyurtma berish uchun quyidagi tugmani bosing 👇',
    { reply_markup: { inline_keyboard: [[{ text: '🛒 Ilovamizga kiring', web_app: { url: APP_URL } }]] } }
  );
});

app.get('/health', (req, res) => res.send('Zero Maks Bot ishlayapti ✅'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server port ${PORT} da ishga tushdi`));
              
