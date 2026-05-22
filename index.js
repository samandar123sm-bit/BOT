const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname)));

const BOT_TOKEN = '8767223581:AAHcaekUAnascE8YnM1jaTlJzRPxbC_gNMM';
const APP_URL = 'https://t.me/ZeroMaxxbot/ilovasi';
const ADMIN_PASSWORD = 'zeromaks2026';
const API = 'https://api.telegram.org/bot' + BOT_TOKEN;

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

function getAdminState(chat_id) {
  return loadDB().adminState[String(chat_id)] || null;
}

function setAdminState(chat_id, state) {
  const db = loadDB();
  if (state === null) {
    delete db.adminState[String(chat_id)];
  } else {
    db.adminState[String(chat_id)] = state;
  }
  saveDB(db);
}

async function sendMessage(chat_id, text, extra) {
  const body = Object.assign({ chat_id: chat_id, text: text, parse_mode: 'HTML' }, extra || {});
  const res = await fetch(API + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function copyMessage(chat_id, from_chat_id, message_id) {
  const res = await fetch(API + '/copyMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat_id, from_chat_id: from_chat_id, message_id: message_id })
  });
  return res.json();
}

const MAIN_MENU = {
  keyboard: [
    [{ text: '👨‍💻 Dasturchi bilan boglanish' }]
  ],
  resize_keyboard: true,
  persistent: true
};

async function answerCallback(callback_query_id, text) {
  await fetch(API + '/answerCallbackQuery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id, text: text || '' })
  });
}

async function editMessageReplyMarkup(chat_id, message_id) {
  await fetch(API + '/editMessageReplyMarkup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, message_id, reply_markup: { inline_keyboard: [] } })
  }).catch(() => {});
}

async function sendToUser(tgId, text) {
  if (!tgId) return;
  await fetch(API + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: tgId, text })
  }).catch(() => {});
}

app.post('/webhook', async function(req, res) {
  res.sendStatus(200);

  const update = req.body;

  // ====== CALLBACK QUERY HANDLER ======
  if (update.callback_query) {
    const cb = update.callback_query;
    const data = cb.data || '';
    const cbChatId = cb.message && cb.message.chat && cb.message.chat.id;
    const msgId = cb.message && cb.message.message_id;

    // tgId ni xabar matnidan olamiz
    const msgText = (cb.message && (cb.message.caption || cb.message.text)) || '';
    const tgMatch = msgText.match(/Telegram ID[:\s]+([0-9]+)/);
    const tgId = tgMatch ? tgMatch[1] : null;

    // Buyurtma raqamini olamiz
    const orderMatch = msgText.match(/#([0-9]+)/);
    const orderNum = orderMatch ? '#' + orderMatch[1] : null;

    const statusMsgMap = {
      confirmed: `✅ Buyurtmangiz ${orderNum} tasdiqlandi! Tayyorlanmoqda 👨‍🍳`,
      rejected:  `❌ Afsuski, buyurtmangiz ${orderNum} rad etildi.`,
      delivering:`🚚 Buyurtmangiz ${orderNum} chiqib ketti! Biroz kuting 🕐`,
      done:      `✅ Buyurtmangiz ${orderNum} yetib keldi! Ishtaha bo'lsin! 🍔`,
      unavailable:`😔 Buyurtmangiz ${orderNum} da ba'zi mahsulotlar qolmagan.`,
    };

    let action = null;

    if (data.startsWith('pay_ok_')) {
      action = 'confirmed';
    } else if (data.startsWith('pay_rej_')) {
      action = 'rejected';
    } else if (data.startsWith('confirm_')) {
      action = 'confirmed';
    } else if (data.startsWith('reject_')) {
      action = 'rejected';
    } else if (data.startsWith('deliver_')) {
      action = 'delivering';
    } else if (data.startsWith('unavail_') || data.startsWith('nostock_')) {
      action = 'unavailable';
    }

    if (action) {
      // Foydalanuvchiga xabar yuborish
      if (tgId && statusMsgMap[action]) {
        await sendToUser(tgId, statusMsgMap[action]);
      }
      // Callback ga javob berish (yuklash ko'rsatkichini o'chirish)
      await answerCallback(cb.id, action === 'confirmed' ? '✅ Tasdiqlandi' : action === 'rejected' ? '❌ Rad etildi' : '✔️ Bajarildi');
      // Tugmalarni o'chirish
      if (cbChatId && msgId) {
        await editMessageReplyMarkup(cbChatId, msgId);
      }
      // Guruhga status xabari
      if (cbChatId) {
        const adminMsg = {
          confirmed: `✅ <b>TASDIQLANDI</b> — ${orderNum}`,
          rejected:  `❌ <b>RAD ETILDI</b> — ${orderNum}`,
          delivering:`🚚 <b>CHIQIB KETTI</b> — ${orderNum}`,
          done:      `✅ <b>YETKAZILDI</b> — ${orderNum}`,
          unavailable:`😔 <b>MAHSULOT QOLMAGAN</b> — ${orderNum}`,
        };
        await sendMessage(cbChatId, adminMsg[action] || `✔️ ${orderNum} — ${action}`, {});
      }
    } else {
      await answerCallback(cb.id, '');
    }
    return;
  }
  // ====================================

  const message = update && update.message;
  if (!message) return;

  const chat_id = message.chat.id;
  const from = message.from;
  const text = message.text || '';
  const state = getAdminState(chat_id);

  saveUser(from);

  if (text === '/start' || text.indexOf('/start ') === 0) {
    await sendMessage(
      chat_id,
      '<b>Assalomu alaykum, ' + (from.first_name || 'doest') + '!</b>\n\nZero Maks ilovasiga xush kelibsiz!\n\nOnlayn buyurtma berish uchun quyidagi tugmani bosing',
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '🛒 Ilovani ochish', web_app: { url: APP_URL } }
          ]]
        }
      }
    );
    await sendMessage(chat_id, 'Quyidagi menyudan foydalaning:', {
      reply_markup: MAIN_MENU
    });
    return;
  }

  if (state === 'wait_password') {
    if (text === '❌ Bekor qilish') {
      setAdminState(chat_id, null);
      await sendMessage(chat_id, 'Bekor qilindi.', { reply_markup: MAIN_MENU });
      return;
    }
    if (text === ADMIN_PASSWORD) {
      setAdminState(chat_id, 'wait_broadcast');
      await sendMessage(chat_id, '✅ <b>Parol togri!</b>\n\nYuboriladigan xabarni yozing yoki rasm/video yuboring.\nBarcha foydalanuvchilarga tarqatiladi', {
        reply_markup: {
          keyboard: [[{ text: '❌ Bekor qilish' }]],
          resize_keyboard: true
        }
      });
    } else {
      setAdminState(chat_id, null);
      await sendMessage(chat_id, '❌ <b>Parol notogri!</b>', { reply_markup: MAIN_MENU });
    }
    return;
  }

  if (state === 'wait_broadcast') {
    if (text === '❌ Bekor qilish') {
      setAdminState(chat_id, null);
      await sendMessage(chat_id, 'Bekor qilindi.', { reply_markup: MAIN_MENU });
      return;
    }

    setAdminState(chat_id, null);
    const users = getAllUsers();
    let success = 0, failed = 0;

    await sendMessage(chat_id, 'Yuborilmoqda... (' + users.length + ' ta foydalanuvchi)');

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      if (String(user.id) === String(chat_id)) { success++; continue; }
      try {
        const r = await copyMessage(user.id, chat_id, message.message_id);
        if (r.ok) success++;
        else failed++;
      } catch(e) { failed++; }
      await new Promise(function(r) { setTimeout(r, 50); });
    }

    await sendMessage(
      chat_id,
      '✅ <b>Xabar tarqatildi!</b>\n\nJami: ' + users.length + ' ta\nYuborildi: ' + success + ' ta\nXato: ' + failed + ' ta',
      { reply_markup: MAIN_MENU }
    );
    return;
  }

  if (text === '👨‍💻 Dasturchi bilan boglanish') {
    await sendMessage(
      chat_id,
      '👨‍💻 <b>Dasturchi:</b> @xwSamandar\n\nHar qanday savol yoki taklif uchun murojaat qiling!',
      { reply_markup: MAIN_MENU }
    );
    return;
  }

  if (text === '❌ Bekor qilish') {
    setAdminState(chat_id, null);
    await sendMessage(chat_id, 'Bekor qilindi.', { reply_markup: MAIN_MENU });
    return;
  }
});

app.get('/health', function(req, res) {
  res.send('Zero Maks Bot ishlaypti');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Server port ' + PORT + ' da ishga tushdi');
});
