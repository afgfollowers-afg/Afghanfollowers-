# JSONBin Setup Guide - Afghan Followers Admin Panel

Complete guide to configure JSONBin for persistent data storage.

---

## 📋 Step 1: Create JSONBin Account

1. Go to **https://jsonbin.io**
2. Click "Sign Up"
3. Create account (email + password)
4. Verify email
5. Login to dashboard

---

## 🔑 Step 2: Create Two Bins

### Bin 1: Main Data (users, orders, tickets)

1. Click "Create a Bin"
2. Name: `smm-main-data` (or any name)
3. Click "Save"
4. **Copy the BIN ID** (appears in URL or details)
   - Format: looks like `64f1a2b3c4d5e6f7g8h9i0j1`
5. Save it somewhere

### Bin 2: Services Data (compressed)

1. Click "Create a Bin" again
2. Name: `smm-services-data`
3. Click "Save"
4. **Copy the BIN ID**
5. Save it

---

## 🔐 Step 3: Get API Master Key

1. Go to **Account Settings** (top-right menu)
2. Look for "API" or "Master Key" section
3. Click "Show" or "Reveal"
4. **Copy the Master Key**
   - Format: looks like `$2b$10$abc1234...`

---

## ⚙️ Step 4: Set Vercel Environment Variables

### Option A: Via Vercel Web Dashboard

1. Go to **https://vercel.com**
2. Select project: `afghanfollowers`
3. Click "Settings"
4. Go to "Environment Variables"
5. Add these 4 variables:

```
JSONBIN_BIN_ID = your_bin_1_id
JSONBIN_SVC_BIN_ID = your_bin_2_id
JSONBIN_API_KEY = your_master_key
DB_SERVICE_KEY = random_string_16_chars
```

For `DB_SERVICE_KEY`, generate a random string (e.g., `aB3xY9kL2mN8pQrS`)

6. Click "Save"

### Option B: Via Vercel CLI

```bash
vercel env add JSONBIN_BIN_ID
# Paste: your_bin_1_id

vercel env add JSONBIN_SVC_BIN_ID
# Paste: your_bin_2_id

vercel env add JSONBIN_API_KEY
# Paste: your_master_key

vercel env add DB_SERVICE_KEY
# Paste: random_string_16_chars
```

---

## 🚀 Step 5: Deploy

```bash
cd D:/ClaudeFile/AfghanFollowers/repo
git push origin main
# Vercel auto-deploys
# Takes 2-3 minutes
```

Or manually trigger in Vercel dashboard:
- Click "Deployments"
- Click "Redeploy" on latest commit

---

## ✅ Step 6: Test Connection

1. Go to admin panel: **https://afghanfollowers.online/admin.html**
2. Open browser console (F12)
3. Should load without hanging ✅
4. Check console - no timeout errors
5. Data should appear in dashboard

### If still not working:

```javascript
// In browser console:
fetch('/api/db', {method: 'GET'})
  .then(r => {
    console.log('Status:', r.status);
    return r.json();
  })
  .then(d => console.log('Data:', d))
  .catch(e => console.error('Error:', e));
```

This will show exactly what's wrong.

---

## 📝 JSONBin Values Example

```
BIN_ID = 64f1a2b3c4d5e6f7g8h9i0j1
SVC_BIN_ID = 65g2b3c4d5e6f7g8h9i0j1k2
API_KEY = $2b$10$abc1234567890abcdefghijklmnopqrstuvwxyz
DB_SERVICE_KEY = aB3xY9kL2mN8pQrS
```

---

## 🔄 Automatic Backups

JSONBin stores data in their cloud. To backup locally:

```bash
curl -H "X-Master-Key: $API_KEY" \
  https://api.jsonbin.io/v3/b/JSONBIN_BIN_ID/latest > backup.json
```

---

## ❓ Troubleshooting

### "Unauthorized" error
- ✅ Check API_KEY is correct
- ✅ Check BIN_ID matches

### "Database not configured" in console
- ✅ Environment variables not set
- ✅ Vercel redeploy not complete
- ✅ Wait 5 minutes for DNS propagation

### Still hanging after 8 seconds
- ✅ Check Vercel Logs: `vercel logs`
- ✅ Check JSONBin API status

### Data not syncing between devices
- ✅ Each browser sends to same BIN_ID
- ✅ Should auto-sync via pullFromServer() every 30s

---

## 📊 How It Works

```
Admin Panel
    ↓
fetch('/api/db')
    ↓
api/db.js
    ↓
JSONBin API (jsonbin.io)
    ↓
smm_users, smm_orders, smm_tickets, smm_svc
```

Every GET request:
- Reads from JSONBin
- Returns to browser
- Browser stores in localStorage
- UI updates

Every POST request:
- Browser sends changes
- api/db.js writes to JSONBin
- All devices sync via periodic GET

---

## 💾 Data Stored

```json
{
  "smm_ts": 1708394400000,
  "smm_users": [...],
  "smm_orders": [...],
  "smm_tickets": [...],
  "smm_providers": [...],
  "smm_payment_methods": [...],
  "smm_general": {...},
  "smm_bonuses": [...],
  "smm_coupons": [...],
  "smm_categories": [...],
  "smm_blog": [...],
  "smm_error_log": [...]
}
```

Max size: ~100KB per bin (JSONBin free plan limit)
Services bin is GZIP-compressed to fit

---

**Done!** Your admin panel should work perfectly now. 🎉
