# ⚙️ Automation Setup Guide
## Afghanfollowers Daily Reporting & Email System

---

## 📊 Daily Status Report to Telegram

### Setup Location:
```
C:\Users\mohse\daily-site-report.ps1
```

### Prerequisites:
- PowerShell 5.0+
- Windows Task Scheduler
- Git installed
- Access to repo path
- `x-db-key` from Vercel environment

### Configuration:

Edit `daily-site-report.ps1` lines 5-7:

```powershell
# Line 5: Your repository path
$repoPath = "C:\Users\mohse\Afghanfollowers-"

# Line 7: Database service key (from .env or Vercel)
$dbKey = "your-db-key-here"

# Line 6: Telegram API endpoint
$telegramUrl = "https://afghanfollowers.online/api/notify-telegram"
```

### Schedule Setup:

Open PowerShell as Administrator and run:

```powershell
# Create action (run script)
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-ExecutionPolicy Bypass -File C:\Users\mohse\daily-site-report.ps1"

# Create trigger (daily at 21:00 UTC)
$trigger = New-ScheduledTaskTrigger -Daily -At "21:00"

# Register task
Register-ScheduledTask -TaskName "Daily-Site-Report" `
  -Action $action -Trigger $trigger
```

### Verify Installation:

```powershell
Get-ScheduledTask -TaskName "Daily-Site-Report"
Get-ScheduledTaskInfo -TaskName "Daily-Site-Report"
```

### Manual Test:

```powershell
& "C:\Users\mohse\daily-site-report.ps1"
```

### What It Does:

✅ Checks recent git commits  
✅ Verifies branch name  
✅ Checks for uncommitted changes  
✅ Runs tests (if npm available)  
✅ Generates Persian report  
✅ Sends to Telegram via API  
✅ Logs results  

### Report Format:

```
📊 گزارش روزانه سایت - 2026-07-25

✅ وضعیت کل: سالم

📁 شاخه: claude/logo-design-improvement-263j0c

📝 آخرین تغییرات:
184dc52 Fix: Enable daily email campaign automation
591fd02 Ignore personal PowerShell script (local Windows configuration)
1355041 Update .gitignore pattern for PowerShell script

📂 وضعیت فایل‌ها:
✅ تمیز و آماده

🧪 تست‌ها:
✅ تست‌ها پاس شد

💡 توصیه:
✓ سیستم آماده برای production است
✓ بررسی گزارش صورت پذیرفت
```

---

## 📧 Daily Email Campaign Automation

### Configuration File:
```
vercel.json
```

### Current Schedule:

```json
{
  "crons": [
    { "path": "/api/sync-orders", "schedule": "0 3 * * *" },
    { "path": "/api/sync-orders?job=email-campaign", "schedule": "0 8 * * *" }
  ]
}
```

### Cron Schedule Explanation:

```
0 8 * * *
│ │ │ │ │
│ │ │ │ └─ Day of week (0-6, * = any)
│ │ │ └─── Month (1-12, * = any)
│ │ └───── Day of month (1-31, * = any)
│ └─────── Hour (0-23, UTC)
└───────── Minute (0-59)
```

**Current:** Every day at 08:00 UTC (11:30 AM Iran Time)

### Change Schedule:

To change time, edit cron expression:

| Frequency | Expression |
|-----------|-----------|
| Daily 8 AM UTC | `0 8 * * *` ✅ |
| Daily 12 PM UTC | `0 12 * * *` |
| Weekdays only | `0 8 * * 1-5` |
| Mondays only | `0 8 * * 1` |
| Every 6 hours | `0 */6 * * *` |
| Twice daily | `0 8,20 * * *` |

### Deploy Changes:

```bash
git add vercel.json
git commit -m "Update email campaign schedule"
git push
```

Then redeploy to Vercel:
```bash
vercel deploy --prod
```

---

## 🔐 Required Environment Variables

### Vercel Settings → Environment Variables:

```
RESEND_API_KEY=re_xxxxxxxxxxxxx
RESEND_FROM_EMAIL=noreply@afghanfollowers.online
DB_SERVICE_KEY=your-shared-key
AUTH_JWT_SECRET=your-jwt-secret
```

### Local PowerShell:

```powershell
$env:DB_SERVICE_KEY="your-db-key"
```

---

## 🧪 Testing Automation

### Test Email Sending:

```bash
curl -X POST https://afghanfollowers.online/api/send-reset-email \
  -H "Content-Type: application/json" \
  -H "x-db-key: your-db-key" \
  -d '{"email":"test@example.com"}'
```

### Test Email Campaign:

```bash
curl -X POST https://afghanfollowers.online/api/sync-orders?job=email-campaign \
  -H "x-db-key: your-db-key"
```

### Check Recent Reports:

View Telegram channel for daily messages at 21:00 UTC

### Monitor Logs:

**Vercel:**
```
https://vercel.com/[project]/deployments
```

**Local PowerShell logs:**
```
Get-ScheduledTaskInfo -TaskName "Daily-Site-Report"
```

---

## 🐛 Troubleshooting

### Email Campaign Not Sending

**Check:**
1. ✅ `RESEND_API_KEY` is set in Vercel
2. ✅ Email address is valid
3. ✅ Cron job executed (check Vercel Functions logs)
4. ✅ Time zone is UTC (not local)

**Fix:**
```bash
# Manually trigger
curl -X POST https://afghanfollowers.online/api/sync-orders?job=email-campaign \
  -H "x-db-key: $DB_SERVICE_KEY"
```

### Daily Report Not Sending to Telegram

**Check:**
1. ✅ PowerShell script configured correctly
2. ✅ db-key is valid
3. ✅ Windows Task shows last run status
4. ✅ Telegram bot has permissions

**Fix:**
```powershell
# Manual test
& "C:\Users\mohse\daily-site-report.ps1"

# Check task
Get-ScheduledTask -TaskName "Daily-Site-Report" | Get-ScheduledTaskInfo
```

### Time Zone Issues

All times are in **UTC**:
- 08:00 UTC = 11:30 AM Iran Time (UTC+3:30)
- 21:00 UTC = 00:30 AM next day Iran Time

To convert:
```
Iran Time = UTC + 3:30 (or 4:30 during daylight saving)
```

---

## 📊 Monitoring Dashboard

Create a simple status page:

```html
<!-- status.html -->
<h1>Automation Status</h1>
<p>Last email campaign: <span id="lastEmail"></span></p>
<p>Last daily report: <span id="lastReport"></span></p>
<p>Next scheduled email: <span id="nextEmail"></span></p>
<p>Next scheduled report: <span id="nextReport"></span></p>
```

---

## 🔄 Backup & Recovery

### Backup Configuration:

```bash
# Export scheduled task
Export-ScheduledTask -TaskName "Daily-Site-Report" > Daily-Report-Backup.xml

# Backup script
copy "C:\Users\mohse\daily-site-report.ps1" "C:\Users\mohse\daily-site-report.ps1.backup"

# Backup vercel.json
copy vercel.json vercel.json.backup
```

### Restore Configuration:

```bash
# Import scheduled task
Import-ScheduledTask -Xml (Get-Content Daily-Report-Backup.xml | Out-String)

# Restore script
copy "C:\Users\mohse\daily-site-report.ps1.backup" "C:\Users\mohse\daily-site-report.ps1"

# Restore vercel.json
copy vercel.json.backup vercel.json
```

---

## 📚 Related Documentation

- **Security Audit:** `PROJECT_SESSION.md`
- **API Reference:** `/api/send-reset-email.js`
- **Sync Orders:** `/api/sync-orders.js`
- **Telegram Notifications:** `/api/notify-telegram.js`

---

**Last Updated:** 2026-07-25  
**Maintained By:** Claude Code  
**Status:** ✅ Active & Monitoring
