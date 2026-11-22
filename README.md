# LIVEX — ONE PLATFORM. EVERY CREATOR.

## ⬇️ הורדה והתקנה

**[הורדת LiveX ל-Windows ←](https://github.com/sg3r3seg/-/releases/download/v1.0.0-preview/LiveX-Setup-1.0.0.exe)** · [דף הגרסה והוראות התקנה מלאות](https://github.com/sg3r3seg/-/releases/tag/v1.0.0-preview)

1. הורד והפעל את `LiveX-Setup-1.0.0.exe` (ב-SmartScreen: **More info → Run anyway**).
2. בגרסת הבדיקה מפעילים גם את שרת LiveX על המחשב: התקן [Node.js 22](https://nodejs.org), הורד את [`LiveX-Test-Server.zip`](https://github.com/sg3r3seg/-/releases/download/v1.0.0-preview/LiveX-Test-Server.zip), חלץ לתוכו את קובץ המפתחות `livex-dev-server-keys.zip`, והפעל את `start-server.cmd`.
3. צור חשבון באתר שנפתח (`http://127.0.0.1:8787`), רכוש במצב Sandbox, והזן את קוד ההפעלה ב-LiveX.

---

LiveX היא אפליקציית Windows לניהול שידורים חיים ב-TikTok LIVE, ‏YouTube LIVE, ‏Kick ו-Twitch, יחד עם שרת רישוי/חשבונות ואתר.

```
app/      אפליקציית Windows (Electron 44) — ממשק, מודולים, Overlays, TTS, חיבורי פלטפורמות, עדכונים
server/   שרת LiveX (Node 22 + SQLite) — משתמשים, רכישות, רישיונות, קודי הפעלה חד-פעמיים, מכשירים, עדכונים, AI TTS
server/web האתר הרשמי — הרשמה, התחברות, מחירים, תשלום, אזור אישי, העברת רישיון
```

## הפעלה מקומית (פיתוח)

```bash
cd server && npm install && npm run keys     # יוצר מפתחות שרת + כותב את המפתחות הציבוריים ל-app/config
npm start                                    # http://127.0.0.1:8787  (אתר + API)
cd ../app && npm install && npm start        # האפליקציה
```

בפיתוח: תשלומים במצב **Sandbox** (מסומן בבירור, ללא חיוב) ומיילים נשמרים ב-`server/data/outbox/` כש-SMTP לא מוגדר. שני המצבים **נחסמים** כש-`NODE_ENV=production`.

## בניית קובץ ההתקנה

```bash
cd app
npm run icons      # (פעם אחת) אייקון + תמונת אשף ההתקנה
npm run dist:win   # release/LiveX-Setup-<version>.exe
```

דורש `makensis` (Linux: ‏`apt install nsis`, ‏Windows: ‏`choco install nsis`). לא נדרש Wine — האייקון ופרטי הגרסה מוטמעים ב-`LiveX.exe` ב-JS טהור (`scripts/after-pack.js`). ה-CI ב-`.github/workflows/ci.yml` מריץ בדיקות ובונה את המתקין על Windows.

ההתקנה: למשתמש הנוכחי (ללא הרשאות מנהל), עברית/אנגלית, קיצורי דרך, הסרה מלוח הבקרה. הגדרות המשתמש ב-`%APPDATA%\LiveX` נשמרות בעדכון ובהסרה.

## פריסה לייצור

1. שרת עם HTTPS (reverse proxy כמו Caddy/nginx) → `server/.env` לפי `server/.env.example`.
2. `PAYMENT_PROVIDER=stripe` + מפתחות Stripe, ו-Webhook ל-`https://<domain>/api/payments/webhook/stripe` (אירוע `checkout.session.completed`).
3. SMTP לשליחת קודי הפעלה, אימות דוא"ל, איפוס סיסמה ואישור העברה.
4. `LIVEX_API_BASE=https://<domain> npm run keys` בתיקיית server → בניית האפליקציה מחדש (המפתחות הציבוריים והכתובת נצרבים בבנייה). **שמור את `server/keys/` בגיבוי מאובטח** — בלעדיהם לא ניתן לאמת רישיונות קיימים.
5. Docker: `server/Dockerfile` (volumes: ‏`data`, ‏`keys`, ‏`releases`).

ניהול: `npm run admin -- revoke <LICENSE_ID> [reason]`, ‏`npm run admin -- mark-paid <ORDER_ID>`, ‏`npm run admin -- user <email>`; או API תחת `/api/admin` עם `ADMIN_TOKEN`.
פרסום עדכון: `npm run publish-release -- <LiveX-Setup.exe> <x.y.z> "notes"` (חותם את המניפסט ב-Ed25519).

## מערכת הרישוי (LIVEX KEY SYSTEM)

| נושא | מימוש |
|---|---|
| User ID | `LVX-USER-000001`, נוצר בשרת מתוך מזהה השורה ואינו משתנה |
| קוד אישי | `LVX-SHAY-8K29-PQ71` — תג שם + 8 תווים אקראיים קריפטוגרפיים, ייחודי ב-DB. מזהה תצוגה, לא סוד |
| קוד הפעלה | `LVX-XXXX-XXXX-XXXX-XXXX-XXXX` (~99 ביט אקראיות), נוצר בשרת בלבד אחרי אישור תשלום בצד השרת |
| אחסון הקוד | HMAC-SHA256 עם pepper סודי בשרת + עותק מוצפן AES-256-GCM להצגה לבעלים באזור האישי (עד שימוש) |
| חד-פעמיות | `UPDATE … WHERE used_at IS NULL` בטרנזקציה — רק בקשה אחת יכולה לנצל קוד; ניסיון נוסף → `CODE_ALREADY_USED` |
| קוד של חשבון אחר | `CODE_OWNER_MISMATCH` |
| ניסיונות | 5 כישלונות ל-15 דקות למשתמש + Rate limit לפי IP; תפוגה 30 יום |
| מוצרים | PRO ‏₪19.90 → `pro`; ‏TTS ‏₪29.90 → `tts`; ‏BUNDLE ‏₪39.90 → `pro`+`tts` (מחירים נקבעים בשרת, הסכום ששולם נבדק מול ההזמנה) |
| מכשיר | מזהה התקנה אקראי (32 בייט) מוצפן ב-DPAPI, ללא טביעת אצבע חומרתית; מכשיר אחד לרישיון (ניתן להגדרה) |
| העברה | באתר: סיסמה + קישור חד-פעמי בדוא"ל → המכשיר הישן מנותק וה-session שלו מבוטל → במחשב החדש "שימוש במחשב זה". מגבלה: 3 בשנה |
| אימות בכל פתיחה | שרת → רענון session (rotation + זיהוי שימוש חוזר) → סטטוס רישיון → שיוך מכשיר → הרשאות → **Lease חתום Ed25519** |
| הרשאות באפליקציה | נגזרות **רק** מ-Lease שחתימתו אומתה במפתח הציבורי המוטמע ושה-`dev` שלו הוא ההתקנה הזו; נאכפות בתהליך הראשי (IPC) |
| Offline | מותר רק עם Lease חתום ובתוקף (ברירת מחדל 48 שעות). ללא Lease — חסום. אין אפשרות לזייף ללא המפתח הפרטי של השרת |
| ביטול | `revoke` בשרת → בבדיקה הבאה (כל 5 דקות / רענון) המודולים ננעלים עם הודעה ברורה |

## אבטחת האפליקציה

Context Isolation, ‏`sandbox: true`, ‏Node Integration כבוי, Preload עם רשימת ערוצים סגורה, אימות שולח בכל IPC (רק הדף שלנו), CSP קשיח, חסימת ניווט/חלונות חדשים, הרשאות רק למיקרופון (Voice Studio), DevTools כבוי בגרסה ארוזה, Electron Fuses (ללא RunAsNode / ‏NODE_OPTIONS / ‏inspect, אימות שלמות ASAR, טעינה רק מ-ASAR). ‏Refresh token, מפתחות פלטפורמות של המשתמש ו-Lease נשמרים מוצפנים ב-DPAPI. אין סודות שרת באפליקציה — רק שני מפתחות ציבוריים.

## עדכונים

מניפסט חתום Ed25519 (מפתח נפרד מהטוקנים) → אימות חתימה באפליקציה → הורדה מאותו שרת בלבד → בדיקת גודל + SHA-512 → בדיקת Authenticode (חובה אם `requireAuthenticode` במניפסט) → הרצת המתקין. ההגדרות נשמרות.

> **חתימת קוד Windows (Authenticode):** קובץ ההתקנה לא חתום בתעודת Code Signing (נדרשת תעודה מסחרית). ללא חתימה Windows SmartScreen יציג אזהרה. לאחר רכישת תעודה: חתום את `LiveX.exe` ואת המתקין והגדר `requireAuthenticode: true` במניפסט.

## מודולים

Dashboard · חשבון ורישיון · חיבורים · LiveX TTS · Voice Studio · Live Alerts · Chat Bot · Custom Commands · Sound Board · Macro · Remote Control · Timer · Challenges · Giveaway · Overlay Editor · Overlay Center · Stream Schedule · Community · Highlights · Analytics · Performance · Diagnostics · Settings.

Overlays מקומיים ל-OBS (‏`127.0.0.1:4777`, עם מפתח לכל התקנה ובדיקת Origin): ‏`/alerts` ‏`/chat` ‏`/tts` ‏`/wheel` ‏`/follower-goal` ‏`/timer` ‏`/giveaway`. כל כתובת נבדקת בטעינה אמיתית לפני שאפשר להעתיק אותה. לא מוצגת כתובת ציבורית.

## חיבורי פלטפורמות — מצב אמיתי

| פלטפורמה | חיבור | מה צריך |
|---|---|---|
| Twitch | IRC רשמי על WebSocket. קריאה ללא התחברות; כתיבה עם OAuth token של הבוט | שם ערוץ |
| YouTube LIVE | YouTube Data API v3 רשמי — צ׳אט, Super Chat, חברויות, צופים | מפתח API של המשתמש |
| TikTok LIVE | אין API ציבורי רשמי לאירועי LIVE → חיבור לספק אינטגרציה ב-WebSocket (למשל Event API המקומי של TikFinity, ‏`ws://127.0.0.1:21213/`) | ספק פועל |
| Kick | ה-API הרשמי דורש אפליקציית מפתחים + Webhooks לשרת ציבורי. עד אז: פיד הצ׳אט הציבורי של הערוץ — **מסומן "מחבר לא רשמי"** | שם ערוץ / מזהה חדר |
| Discord | Webhook רשמי להודעות (עלייה לשידור, לוח שידורים) | כתובת Webhook |

אין נתונים מומצאים: צופים/מתנות/עוקבים מוצגים רק אם הפלטפורמה סיפקה אותם; התראות בדיקה מסומנות TEST ואינן נספרות באנליטיקה.

## TTS

קולות Windows (SAPI, כולל עברית אם מותקנת חבילת דיבור) מרונדרים ל-WAV ומושמעים בהתקן השמע שנבחר. תור, השהיה/המשך, דילוג, ניקוי, חסימת מילים (התאמה למילה שלמה), סינון פוגעני, הגבלת אורך, Overlay. ‏Voice Studio: פרופילים, תצוגה מקדימה, הקלטה/העלאה. קולות AI ושיבוט קול — דרך השרת בלבד (`ELEVENLABS_API_KEY`), עם בדיקת רישיון TTS בכל בקשה, ושיבוט רק עם הצהרת הסכמה מפורשת שנשמרת בשרת. כל עוד הספק לא הוגדר — מוצג "לא זמין".

## בדיקות

```bash
cd server && npm test   # 15 בדיקות: כל 12 תרחישי החובה + brute force, תפוגה, idempotency, אחסון hash, rotation, איפוס סיסמה, הרשאת TTS
cd app && npm test      # 16 בדיקות: אימות Lease/חתימות (שרת מזויף, שינוי payload, תפוגה, מכשיר אחר), מניפסט עדכון, סינון TTS, הרשאות, הגרלה, Overlay server
```

תרחיש 12 (כשל שרת): האפליקציה לעולם לא מציגה הצלחה — כל קריאה שנכשלה נדחית, משתמש חדש ללא Lease נחסם, ו-Lease לא חתום/מזויף נדחה.
