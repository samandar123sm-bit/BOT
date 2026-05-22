const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

// HTML faylni serve qilish (ilova)
app.use(express.static(path.join(__dirname)));

const BOT_TOKEN = '8767223581:AAHcaekUAnascE8YnM1jaTlJzRPxbC_gNMM';
const APP_URL = 'https://t.me/ZeroMaxxbot/ilovasi';
const ADMIN_PASSWORD = 'zeromaks2026';
const API = https://api.telegram.org/bot${BOT_TOKEN};

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

// ===================== TELEGRAM API =====================
async function sendMessage(chat_id, text, extra = {}) {
  const body = { chat_id, text, parse_mode: 'HTML', ...extra };
  const res = await fetch(${API}/sendMessage, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function copyMessage(chat_id, from_chat_id, message_id) {
  const res = await fetch(${API}/copyMessage, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, from_chat_id, message_id })
  });
  return res.json();
}

// Pastki menyu tugmalari
const MAIN_MENU = {
  keyboard: [
    [{ text: '🛒 Buyurtma berish' }, { text: '⚙️ Admin' }],
    [{ text: '👨‍💻 Dasturchi bilan bog\'lanish' }]
  ],
  resize_keyboard: true,
  persistent: true
};

// ===================== WEBHOOK =====================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const update = req.body;
  const message = update?.message;
  if (!message) return;

  const chat_id = message.chat.id;
  const from = message.from;
  const text = message.text || '';
  const state = getAdminState(chat_id);

  // Foydalanuvchini saqla
  saveUser(from);

  // ── /start ──
  if (text === '/start' || text.startsWith('/start ')) {
    await sendMessage(
      chat_id,
      👋 <b>Assalomu alaykum, ${from.first_name || 'do\'st'}!</b>\n\nZero Maks ilovasiga xush kelibsiz! 🍕🍔\n\nOnlayn buyurtma berish uchun quyidagi tugmani bosing 👇,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '🛒 Ilovani ochish', web_app: { url: APP_URL } }
          ]]
        }
      }
    );
    await sendMessage(chat_id, '⬇️ Quyidagi menyudan foydalaning:', {
      reply_markup: MAIN_MENU
    });
    return;
  }

  // ── Admin holati: parol kutilmoqda ──
  if (state === 'wait_password') {
    if (text === '❌ Bekor qilish') {
      setAdminState(chat_id, null);
      await sendMessage(chat_id, '↩️ Bekor qilindi.', { reply_markup: MAIN_MENU });
      return;
    }
    if (text === ADMIN_PASSWORD) {
      setAdminState(chat_id, 'wait_broadcast');
      await sendMessage(chat_id, '✅ <b>Parol to\'g\'ri!</b>\n\nYuboriladigan xabarni yozing yoki rasm/video/fayl yuboring.\nBarcha foydalanuvchilarga tarqatiladi 📢', {
        reply_markup: {
          keyboard: [[{ text: '❌ Bekor qilish' }]],
          resize_keyboard: true
        }
      });
    } else {
      setAdminState(chat_id, null);
      await sendMessage(chat_id, '❌ <b>Parol noto\'g\'ri!</b>', { reply_markup: MAIN_MENU });
    }
    return;
  }
  // ── Admin holati: broadcast xabari kutilmoqda ──
  if (state === 'wait_broadcast') {
    if (text === '❌ Bekor qilish') {
      setAdminState(chat_id, null);
      await sendMessage(chat_id, '↩️ Bekor qilindi.', { reply_markup: MAIN_MENU });
      return;
    }
