# NEXORA AI — setup for beginners (Android, free)

Your Gemini key lives only in a private `.env` file on the server. The website never sees it.

## 1. Get a free Gemini key
1. Open https://aistudio.google.com/apikey and sign in with Google.
2. Tap **Create API key**, copy it.
3. Do NOT add billing or a card anywhere. Without billing, Google cannot charge you; at the limit you just get errors.
Note: on the free tier, Google may use your prompts to improve its products. Don't type private data.

## 2. Install Termux (a Linux terminal for Android)
Install **Termux from F-Droid** (f-droid.org). The Play Store version is outdated.

## 3. Install Node.js
In Termux:
```
pkg update -y
pkg install nodejs unzip -y
termux-setup-storage
```
Tap **Allow** when Android asks for storage access.

## 4. Unpack the project
Download `nexora-ai.zip` to your phone (it goes to Downloads), then:
```
cd ~
unzip ~/storage/downloads/nexora-ai.zip
cd nexora-ai
```

## 5. Add your key
```
cp .env.example .env
nano .env
```
Replace `PASTE_YOUR_KEY_HERE` with your key. Save: **CTRL + X**, then **Y**, then **Enter**
(Termux has a CTRL key on its extra-keys row).

## 6. Run it
```
node server.js
```
It prints `NEXORA AI running: http://localhost:3000`. Open **http://localhost:3000** in Chrome on the same phone.
Keep Termux open while you chat. Stop with CTRL + C.

## Hindi and English
Just type in either (हिन्दी, English or Hinglish). NEXORA answers in the language you used and remembers the conversation until you tap **New chat** or reload.

## Free limits and errors
- Rate limit or daily quota reached: the chat shows a friendly "wait and try again" message. Nothing is charged and no other model is used.
- The server also limits each visitor (10 messages/minute) and the total per day (300), editable in `.env`.
- "Isn't set up correctly": the key is wrong or the model name isn't allowed for your free project. Open AI Studio, check which Flash model shows in your rate-limit page, and put its name in `GEMINI_MODEL`. Google changes model names and limits often, so this setting exists on purpose.
- Details are printed in the Termux window (never in the browser).

## Optional: put it online for free
Hosts like Render have free plans. Upload this folder to a private GitHub repo (`.gitignore` already excludes `.env`), create a Web Service with start command `node server.js`, add `GEMINI_API_KEY` and `HOST=0.0.0.0` under **Environment**, and use the free plan only. If any host asks for a card, stop and stay with Termux. A public site shares your one free quota with everyone, so keep `DAILY_LIMIT` low.

## Security rules
Never paste your key into index.html, GitHub, or chats. If it leaks, delete it at aistudio.google.com/apikey and create a new one.
