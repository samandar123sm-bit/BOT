# Zero Maks — Railway Deploy

## Fayllar
- `index.js` — Bot server
- `zeromaks-v5.html` — Telegram Mini App (ilova)
- `package.json` — Node.js sozlamalari

## Railway ga yuklash

### 1. GitHub repo yarating
1. github.com → New repository → `zeromaks` deb nomlang
2. Ushbu barcha fayllarni yuklang

### 2. Railway deploy
1. railway.app ga kiring (GitHub bilan)
2. New Project → Deploy from GitHub repo → `zeromaks`
3. Deploy bo'lishini kuting
4. Settings → Networking → **Generate Domain** bosing
   - Misol: `zeromaks.up.railway.app`

### 3. Webhook o'rnating
Brauzerda bu linkni oching (YOUR_DOMAIN o'rniga Railway domeningizni yozing):

```
https://api.telegram.org/bot8767223581:AAHcaekUAnascE8YnM1jaTlJzRPxbC_gNMM/setWebhook?url=https://YOUR_DOMAIN/webhook
```

Javob: `{"ok":true}` — muvaffaqiyatli!

### 4. Test
@ZeroMaxxbot ga /start yuboring ✅
