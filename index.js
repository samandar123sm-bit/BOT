const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const BOT_TOKEN = process.env.BOT_TOKEN || '8767223581:AAHcaekUAnascE8YnM1jaTlJzRPxbC_gNMM';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';
const APP_URL = 'https://t.me/ZeroMaxxbot/ilovasi';
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const CARD_NUMBER = '5614 6865 0294 0227';

const OWNER_ID = '1200329840';
const GROUP_ID = '-1003511488835';

// ===================== DATABASE =====================
const DB_FILE = './db.json';
function loadDB() {
  try { if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e) {}
  return { users: {} };
}
function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch(e) {}
}
function saveUser(from) {
  const db = loadDB();
  db.users[from.id] = { id: from.id, first_name: from.first_name || '', username: from.username || '', saved_at: new Date().toISOString() };
  saveDB(db);
}
function getAllUsers() { return Object.values(loadDB().users); }

// ===================== ORDER SESSIONS =====================
// Har bir foydalanuvchi uchun zakaz holati saqlanadi
const orderSessions = {};
// { userId: { step, items, name, phone, location, total, num } }
// step: 'collect' | 'name' | 'phone' | 'location' | 'confirm' | 'payment'

// ── SUHBAT TARIXI (har foydalanuvchi uchun) ──
const conversationHistory = {};
// { userId: [{ role: 'user'|'assistant', content: '...' }, ...] }
const MAX_HISTORY = 4; // oxirgi nechta xabarni saqlash

function addToHistory(userId, role, content) {
  if (!conversationHistory[userId]) conversationHistory[userId] = [];
  conversationHistory[userId].push({ role, content });
  // Faqat oxirgi MAX_HISTORY ta saqlash (tizim xabari hisoblanmaydi)
  if (conversationHistory[userId].length > MAX_HISTORY) {
    conversationHistory[userId] = conversationHistory[userId].slice(-MAX_HISTORY);
  }
}

function getHistory(userId) {
  return conversationHistory[userId] || [];
}

function clearHistory(userId) {
  delete conversationHistory[userId];
}

const pendingOrderStatus = {};
const nostockPending = {};
const broadcastPending = {};

// ===================== MENYU =====================
const MENU_DATA = {
  burger: [
    { name: 'Classic Burger', price: 25000 },
    { name: 'Cheese Burger', price: 28000 },
    { name: 'Spicy Burger', price: 27000 },
    { name: 'Double Burger', price: 35000 },
    { name: 'Crispy Chicken', price: 26000 },
    { name: 'BBQ Burger', price: 30000 },
  ],
  lavash: [
    { name: 'Chicken Lavash', price: 22000 },
    { name: 'Beef Lavash', price: 24000 },
    { name: 'Mix Lavash', price: 23000 },
    { name: 'Caesar Lavash', price: 25000 },
  ],
  pizza: [
    { name: 'Margarita (30sm)', price: 32000 },
    { name: 'Margarita (37sm)', price: 45000 },
    { name: 'Pepperoni (30sm)', price: 36000 },
    { name: 'Pepperoni (37sm)', price: 50000 },
    { name: 'BBQ Chicken (30sm)', price: 38000 },
    { name: 'BBQ Chicken (37sm)', price: 52000 },
    { name: 'Mushroom (30sm)', price: 34000 },
    { name: 'Mushroom (37sm)', price: 48000 },
  ],
  hotdog: [
    { name: 'Classic Hot-dog', price: 15000 },
    { name: 'Cheese Hot-dog', price: 17000 },
    { name: 'Double Hot-dog', price: 20000 },
  ],
  snack: [
    { name: 'Kartoshka fri', price: 12000 },
    { name: 'Chicken nuggets (6 dona)', price: 18000 },
    { name: 'Onion rings', price: 14000 },
    { name: 'Mozzarella sticks', price: 16000 },
  ],
  drink: [
    { name: 'Coca-Cola (0.5L)', price: 8000 },
    { name: 'Pepsi (0.5L)', price: 8000 },
    { name: 'Fanta (0.5L)', price: 8000 },
    { name: 'Sprite (0.5L)', price: 8000 },
    { name: 'Lipton Ice Tea', price: 9000 },
    { name: 'Suv (0.5L)', price: 5000 },
    { name: 'Fresh juice', price: 15000 },
  ],
};

const ALL_ITEMS = Object.values(MENU_DATA).flat();
const fmt = n => n.toLocaleString('uz-UZ') + " so'm";
function generateOrderNum() {
  const ts = Date.now().toString().slice(-6);
  const rnd = Math.floor(Math.random() * 100).toString().padStart(2, '0');
  return '#' + ts + rnd;
}

// ===================== TELEGRAM API =====================
async function sendMessage(chat_id, text, extra = {}) {
  try {
    const res = await fetch(`${API}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', ...extra })
    });
    return res.json();
  } catch(e) { console.error('sendMessage xato:', e.message); return null; }
}

async function copyMessage(chat_id, from_chat_id, message_id) {
  try {
    const res = await fetch(`${API}/copyMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, from_chat_id, message_id })
    });
    return res.json();
  } catch(e) { return { ok: false }; }
}

// ===================== GROQ AI =====================
async function askGroq(systemPrompt, userMessage, temperature = 0.3) {
  try {
    const res = await fetch(GROQ_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
        max_tokens: 300,
        temperature
      })
    });
    const data = await res.json();
    if (data.error) {
      if (data.error.message && data.error.message.includes('Rate limit')) {
        console.warn('Groq rate limit (askGroq)');
        return null;
      }
      console.error('Groq xato:', data.error.message);
      return null;
    }
    return data.choices?.[0]?.message?.content || null;
  } catch(e) { console.error('Groq xato:', e.message); return null; }
}

async function askZeroMaksAI(userMessage, context = '', userId = null) {
  const systemPrompt = `Sen ZeroMaks AI — Toshkentdagi ovqat yetkazib berish xizmatining aqlli yordamchisisan.

📞 +998 99 004-11-66 | 💳 Karta: ${CARD_NUMBER}
⏰ 10:00-23:00 tekin yetkazish | 23:00-01:00 = 10,000 so'm | 01:00-10:00 yetkazish yo'q
🕐 O'rtacha yetkazish: 30-45 daqiqa

MENYU:
🍔 Classic 25k | Cheese 28k | Spicy 27k | Double 35k | Crispy Chicken 26k | BBQ Burger 30k
🌯 Chicken 22k | Beef 24k | Mix 23k | Caesar Lavash 25k
🍕 Margarita 30sm/32k 37sm/45k | Pepperoni 30sm/36k 37sm/50k | BBQ Chicken 30sm/38k 37sm/52k | Mushroom 30sm/34k 37sm/48k
🌭 Classic 15k | Cheese 17k | Double Hot-dog 20k
🍟 Kartoshka fri 12k | Nuggets 18k | Onion rings 14k | Mozzarella sticks 16k
🥤 Cola/Pepsi/Fanta/Sprite 8k | Lipton 9k | Suv 5k | Fresh juice 15k

QANDAY ISHLAYSAN:
- Do'stona, yorqin, qiziqarli yoz — xuddi do'st kabi
- O'zbek tilida yoz; rus tilida so'ralsa — rus tilida javob ber
- Taom tavsiya so'ralsa — foydalanuvchi ta'rifiga qarab eng mos tanlang va nima uchun ekanini ayting
- Narx so'ralsa — aniq ko'rsat
- Bir nechta savol bo'lsa — hammasiga javob ber
- Qisqa javob ber (2-4 jumla), lekin savol murakkab bo'lsa to'liqroq yoz
- Foydalanuvchi buyurtma bermoqchi yoki "olaman", "buyurtma" desa → javob oxiriga "ZAKAZ_BOSHLASH" qo'sh
- Buyurtma holati so'ralsa raqam bilan → "BUYURTMA_HOLATI:#RAQAM"
- Raqamsiz → "BUYURTMA_HOLATI:NOMALUM"
${context ? '\n' + context : ''}`;

  try {
    const res = await fetch(GROQ_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          ...( userId ? getHistory(userId) : [] ),
          { role: 'user', content: userMessage }
        ],
        max_tokens: 450,
        temperature: 0.4,
        top_p: 0.9
      })
    });
    const data = await res.json();
    if (data.error) {
      if (data.error.message && data.error.message.includes('Rate limit')) {
        console.warn('Groq rate limit (askZeroMaksAI)');
        return null;
      }
      console.error('Groq xato:', data.error.message);
      return null;
    }
    const reply = data.choices?.[0]?.message?.content || null;
    if (userId && reply) {
      addToHistory(userId, 'user', userMessage);
      // Buyruqlarni tarixdan olib tashlash (faqat sof javobni saqlash)
      const cleanReply = reply.replace(/ZAKAZ_BOSHLASH|BUYURTMA_HOLATI:[^\s]*/g, '').trim();
      if (cleanReply) addToHistory(userId, 'assistant', cleanReply);
    }

    return reply;
  } catch(e) { console.error('Groq xato:', e.message); return null; }
}

// AI yordamida foydalanuvchi yozgan matndan mahsulotlarni ajratib olish
async function extractOrderItems(text) {
  const menuList = ALL_ITEMS.map(i => `${i.name} — ${fmt(i.price)}`).join('\n');
  const systemPrompt = `Foydalanuvchi buyurtma bermoqchi. Quyidagi menyudan foydalanib, foydalanuvchi xabaridan mahsulotlarni va miqdorlarni ajratib ol.
FAQAT JSON qaytар (boshqa narsa yozma):
[{"name":"mahsulot nomi","qty":1,"price":25000}]
Agar hech narsa topilmasa: []

MENYU:
${menuList}

Muhim: name da menyudagi ANIQ nomni yoz. qty sonini aniqlash uchun "2 ta", "bitta", "x3" kabi iboralarni qidir. Default qty=1.`;

  try {
    const raw = await askGroq(systemPrompt, text);
    if (!raw) return [];
    const cleaned = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch(e) { return []; }
}

async function detectBroadcastIntent(text) {
  const systemPrompt = `Foydalanuvchi xabarining niyatini aniqla. FAQAT JSON qaytар:
{"intent":"broadcast","message":"yuboriladigan matn"} — barcha foydalanuvchilarga xabar yubormoqchi bo'lsa
{"intent":"other"} — boshqa holatlarda`;
  try {
    const raw = await askGroq(systemPrompt, text);
    if (!raw) return { intent: 'other' };
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch(e) { return { intent: 'other' }; }
}

// ===================== MENYULAR =====================
const MAIN_MENU = {
  keyboard: [
    [{ text: '🛒 Buyurtma berish' }, { text: '📦 Buyurtmam holati' }],
    [{ text: '👨‍💻 Dasturchi bilan boglanish' }]
  ],
  resize_keyboard: true, persistent: true
};

const LOCATION_KEYBOARD = {
  keyboard: [[{ text: '📍 Joylashuvimni yuborish', request_location: true }], [{ text: '❌ Bekor qilish' }]],
  resize_keyboard: true, one_time_keyboard: true
};

const CANCEL_KEYBOARD = {
  keyboard: [[{ text: '❌ Bekor qilish' }]],
  resize_keyboard: true, one_time_keyboard: true
};

// ===================== ZAKAZ STEPS =====================
async function startOrder(chat_id, from) {
  orderSessions[chat_id] = { step: 'items', items: [], name: '', phone: '', location: null, num: generateOrderNum() };
  await sendMessage(chat_id,
    `🛒 <b>Zakaz boshlaylik!</b>\n\nNima buyurtma qilmoqchisiz? Yozing yoki ro'yxatdan tanlang.\n\nMisol: <i>"2 ta Cheese Burger, 1 ta Cola"</i>\n\nYoki <b>ilovadan</b> qulay buyurtma bering:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🍔 Burgerlar', callback_data: 'menu_burger' }, { text: '🌯 Lavashlar', callback_data: 'menu_lavash' }],
          [{ text: '🍕 Pitsa', callback_data: 'menu_pizza' }, { text: '🌭 Hot-dog', callback_data: 'menu_hotdog' }],
          [{ text: '🍟 Snack', callback_data: 'menu_snack' }, { text: '🥤 Ichimlik', callback_data: 'menu_drink' }],
          [{ text: '📱 Ilovadan buyurtma berish', web_app: { url: APP_URL } }]
        ]
      }
    }
  );
}

async function showMenuCategory(chat_id, cat) {
  const items = MENU_DATA[cat];
  const catNames = { burger: '🍔 Burgerlar', lavash: '🌯 Lavashlar', pizza: '🍕 Pitsa', hotdog: '🌭 Hot-doglar', snack: '🍟 Snacklar', drink: '🥤 Ichimliklar' };
  const text = `<b>${catNames[cat]}</b>\n\n` + items.map(i => `• ${i.name} — ${fmt(i.price)}`).join('\n');
  await sendMessage(chat_id, text + '\n\n<i>Yozing: "2 ta Cheese Burger, 1 ta Cola"</i>', {
    reply_markup: { inline_keyboard: [[{ text: '⬅️ Orqaga', callback_data: 'menu_back' }]] }
  });
}

async function processItemsStep(chat_id, text) {
  const session = orderSessions[chat_id];
  if (!session) return;

  // Mahsulotlarni ajratib olish
  const items = await extractOrderItems(text);

  if (!items || items.length === 0) {
    await sendMessage(chat_id,
      `❓ Qaysi mahsulotni buyurtma qilmoqchisiz?\n\nMenyu nomlarini aniqroq yozing:\n• <i>"2 ta Cheese Burger"</i>\n• <i>"1 Pepperoni pizza 30sm"</i>\n• <i>"Kartoshka fri + Cola"</i>`,
      { reply_markup: { inline_keyboard: [[{ text: '📱 Ilovadan buyurtma berish', web_app: { url: APP_URL } }]] } }
    );
    return;
  }

  session.items = items;
  session.total = items.reduce((s, i) => s + (i.price * i.qty), 0);

  const itemsText = items.map(i => `• ${i.name} × ${i.qty} — ${fmt(i.price * i.qty)}`).join('\n');
  session.step = 'name';

  await sendMessage(chat_id,
    `✅ <b>Buyurtma tarkibi:</b>\n\n${itemsText}\n\n💰 <b>Jami: ${fmt(session.total)}</b>\n\n👤 Ismingizni yozing:`,
    { reply_markup: CANCEL_KEYBOARD }
  );
}

async function processNameStep(chat_id, text) {
  const session = orderSessions[chat_id];
  session.name = text.trim();
  session.step = 'phone';
  await sendMessage(chat_id, `📞 Telefon raqamingizni yozing:\n<i>Misol: 99 004 11 66</i>`, { reply_markup: CANCEL_KEYBOARD });
}

async function processPhoneStep(chat_id, text) {
  const session = orderSessions[chat_id];
  const phone = text.replace(/\D/g, '');
  if (phone.length < 9) {
    await sendMessage(chat_id, `❌ Telefon raqam noto'g'ri. Qaytadan kiriting:\n<i>Misol: 99 004 11 66</i>`, { reply_markup: CANCEL_KEYBOARD });
    return;
  }
  session.phone = '+998 ' + text.trim();
  session.step = 'location';
  await sendMessage(chat_id, `📍 Joylashuvingizni yuboring — yetkazib beramiz!`, { reply_markup: LOCATION_KEYBOARD });
}

async function processLocationStep(chat_id, location) {
  const session = orderSessions[chat_id];
  session.location = location;
  session.step = 'confirm';

  const itemsText = session.items.map(i => `• ${i.name} × ${i.qty} — ${fmt(i.price * i.qty)}`).join('\n');

  await sendMessage(chat_id,
    `📋 <b>Buyurtmani tasdiqlang:</b>\n\n${itemsText}\n\n💰 <b>Jami: ${fmt(session.total)}</b>\n👤 Ism: ${session.name}\n📞 Tel: ${session.phone}\n📍 Joylashuv: ✅ aniqlandi\n\n💳 To'lov: Karta (${CARD_NUMBER})`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Tasdiqlash', callback_data: 'order_confirm' }, { text: '❌ Bekor qilish', callback_data: 'order_cancel' }]
        ]
      }
    }
  );
}

async function confirmOrder(chat_id, from) {
  const session = orderSessions[chat_id];
  if (!session) return;

  const itemsText = session.items.map(i => `${i.name} ×${i.qty} — ${fmt(i.price * i.qty)}`).join('\n');
  const tgLine = from.id ? `\n🔵 Telegram ID: ${from.id}` : '';

  const msg = `🔔 YANGI ZAKAZ ${session.num}\n\n👤 Mijoz: ${session.name}\n📞 Telefon: ${session.phone}${tgLine}\n📍 Joylashuv: quyida ⬇️\n\n🛒 BUYURTMA:\n${itemsText}\n\n💰 JAMI: ${fmt(session.total)}\n💳 TO'LOV: Karta\n⏰ ${new Date().toLocaleString('uz-UZ')}`;

  // Guruhga yuborish
  try {
    await fetch(`${API}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: GROUP_ID, text: msg,
        reply_markup: { inline_keyboard: [[{ text: '❌ Tovar tugagan', callback_data: 'nostock_' + session.num }]] }
      })
    });

    // Lokatsiya yuborish
    if (session.location) {
      await fetch(`${API}/sendLocation`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: GROUP_ID, latitude: session.location.latitude, longitude: session.location.longitude })
      });
    }
  } catch(e) { console.error('Guruhga yuborish xato:', e.message); }

  // Foydalanuvchiga tasdiqlash
  await sendMessage(chat_id,
    `✅ <b>Zakaz qabul qilindi! ${session.num}</b>\n\n💳 Iltimos, ${fmt(session.total)} kartaga o'tkazing:\n<b>${CARD_NUMBER}</b>\n\nTo'lov tasdiqlangach yetkazib beramiz! 🚀\n\nYoki ilovadan ham buyurtma bera olasiz:`,
    {
      reply_markup: {
        inline_keyboard: [[{ text: '📱 Ilovani ochish', web_app: { url: APP_URL } }]],
      }
    }
  );
  await sendMessage(chat_id, 'Boshqa savollar bo\'lsa yozing!', { reply_markup: MAIN_MENU });

  delete orderSessions[chat_id];
}

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
    const cbFrom = cb.from;

    const answerCb = async (text = '') => {
      await fetch(`${API}/answerCallbackQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cb.id, text })
      });
    };
    const removeButtons = async () => {
      await fetch(`${API}/editMessageReplyMarkup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cbChatId, message_id: cbMsgId, reply_markup: { inline_keyboard: [] } })
      });
    };

    // Menyu kategoriyalar
    if (data.startsWith('menu_')) {
      const cat = data.replace('menu_', '');
      if (cat === 'back') {
        await answerCb();
        await startOrder(cbChatId, cbFrom);
      } else {
        await answerCb();
        await showMenuCategory(cbChatId, cat);
      }
      return;
    }

    // Zakaz tasdiqlash
    if (data === 'order_confirm') {
      await answerCb('Tasdiqlandi!');
      await removeButtons();
      await confirmOrder(cbChatId, cbFrom);
      return;
    }

    if (data === 'order_cancel') {
      await answerCb('Bekor qilindi');
      await removeButtons();
      delete orderSessions[cbChatId];
      await sendMessage(cbChatId, '❌ Zakaz bekor qilindi.', { reply_markup: MAIN_MENU });
      return;
    }

    // Broadcast
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
          if (r && r.ok) success++; else failed++;
        } catch(e) { failed++; }
        await new Promise(r => setTimeout(r, 50));
      }
      await sendMessage(OWNER_ID, `✅ <b>Yuborildi!</b>\n\n👥 Jami: ${users.length}\n✅ Muvaffaqiyatli: ${success}\n❌ Xato: ${failed}`, { reply_markup: MAIN_MENU });
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
        await sendMessage(pending.tgId, `😔 Kechirasiz, <b>${orderNum}</b> buyurtmangizdagi <b>${productName}</b> tugagan.\n\n+998990041166 ga murojaat qiling.`);
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
        const aiReply = await askZeroMaksAI(`Admin aytdi: "${adminReply}". ${orderNum} buyurtma haqida foydalanuvchiga chiroyli xabar yoz. BUYURTMA_HOLATI tagini ishlatma.`, '', pending.userId);
        const finalMsg = (aiReply && !aiReply.includes('BUYURTMA_HOLATI:')) ? aiReply : `📦 <b>${orderNum}</b> buyurtmangiz holati:\n\n${adminReply}`;
        await sendMessage(pending.userId, finalMsg, { reply_markup: MAIN_MENU });
        await sendMessage(GROUP_ID, `✅ ${pending.firstName} ga javob yuborildi.`);
        delete pendingOrderStatus[orderNum];
      }
      return;
    }
    return;
  }

  // ── LOKATSIYA ──
  if (message.location) {
    const session = orderSessions[chat_id];
    if (session && session.step === 'location') {
      await processLocationStep(chat_id, message.location);
    }
    return;
  }

  // ── BEKOR QILISH TUGMASI ──
  if (text === '❌ Bekor qilish') {
    delete orderSessions[chat_id];
    clearHistory(chat_id);
    await sendMessage(chat_id, '❌ Bekor qilindi.', { reply_markup: MAIN_MENU });
    return;
  }

  // ── ZAKAZ SESSION DAVOM ETISH ──
  const session = orderSessions[chat_id];
  if (session) {
    if (session.step === 'items') { await processItemsStep(chat_id, text); return; }
    if (session.step === 'name') { await processNameStep(chat_id, text); return; }
    if (session.step === 'phone') { await processPhoneStep(chat_id, text); return; }
    if (session.step === 'location') {
      await sendMessage(chat_id, '📍 Iltimos, joylashuvingizni tugma orqali yuboring:', { reply_markup: LOCATION_KEYBOARD });
      return;
    }
  }

  // ── ODDIY FOYDALANUVCHI VA EGA uchun /start ──
  if (text === '/start' || text.startsWith('/start ')) {
    clearHistory(chat_id);
    await sendMessage(chat_id,
      `Assalomu alaykum, <b>${from.first_name || 'do\'st'}!</b>\n\nMen <b>ZeroMaks AI</b> — aqlli yordamchingizman! 🤖🍕\n\nBuyurtma berish, menyu, narxlar va har qanday savol bo'yicha yordam beraman.\n\nShunchaki yozing — tushunaman! 💬`,
      { reply_markup: { inline_keyboard: [[{ text: '🛒 Ilovani ochish', web_app: { url: APP_URL } }]] } }
    );
    await sendMessage(chat_id, 'Quyidagi menyudan foydalaning:', { reply_markup: MAIN_MENU });
    return;
  }

  if (text === '🛒 Buyurtma berish') {
    await startOrder(chat_id, from);
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

  // ── BOT EGASI (maxsus buyruqlar) ──
  if (isOwner) {
    // Foydalanuvchilar soni
    if (text === '/users' || text.toLowerCase() === 'nechta foydalanuvchi') {
      const users = getAllUsers();
      await sendMessage(OWNER_ID, `👥 <b>Jami foydalanuvchilar: ${users.length} ta</b>`, { reply_markup: MAIN_MENU });
      return;
    }

    // Broadcast — faqat "barcha", "hammaga", "xabar yubor" so'zlari bo'lsa tekshir
    const broadcastKeywords = ['barcha', 'hammaga', 'broadcast', 'xabar yubor', 'yubormoqchi'];
    if (broadcastKeywords.some(kw => text.toLowerCase().includes(kw))) {
      const intent = await detectBroadcastIntent(text);
      if (intent?.intent === 'broadcast' && intent?.message) {
        broadcastPending[OWNER_ID] = { fromChatId: chat_id, messageId: message.message_id };
        const users = getAllUsers();
        await sendMessage(OWNER_ID,
          `📢 <b>Broadcast</b>\n\n"${intent.message}"\n\n👥 Foydalanuvchilar: ${users.length} ta\n\nYuborilaymi?`,
          { reply_markup: { inline_keyboard: [[{ text: '✅ Ha, yubor', callback_data: 'broadcast_yes' }, { text: '❌ Bekor', callback_data: 'broadcast_no' }]] } }
        );
        return;
      }
    }
  }

  // ── ZEROMAKS AI (ega va oddiy foydalanuvchi) ──
  const aiContext = isOwner ? 'Bu bot egasi (admin).' : '';
  const aiResponse = await askZeroMaksAI(text, aiContext, chat_id);
  if (!aiResponse) {
    await sendMessage(chat_id, 'Hozirda javob bera olmayapman. Keyinroq urinib ko\'ring.', { reply_markup: MAIN_MENU });
    return;
  }

  if (aiResponse.includes('ZAKAZ_BOSHLASH')) {
    await startOrder(chat_id, from);
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
      await sendMessage(chat_id, `🔍 <b>${orderNum}</b> holati so'raldi. Admin tez orada javob beradi! ⏳`, { reply_markup: MAIN_MENU });
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

    
