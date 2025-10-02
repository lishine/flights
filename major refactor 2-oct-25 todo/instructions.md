# Manual Setup Instructions

This file contains all the steps **YOU** need to do manually (outside of code). The AI will handle code changes in the phases.

---

## Prerequisites

### 1. Create Development Bot (BotFather)
1. Open Telegram, search for `@BotFather`
2. Send `/newbot`
3. Follow prompts:
   - Name: `MyFlightBot Dev` (or your preferred name)
   - Username: Must end in "bot", e.g., `myflightbot_dev_bot`
4. **Save the token** - looks like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
5. Optional: Set bot description, about text, profile picture

### 2. Get Your Admin Chat ID
1. Message `@userinfobot` on Telegram
2. It will reply with your User ID (e.g., `987654321`)
3. **Save this number** - you'll use it for ADMIN_CHAT_IDS

### 3. Generate Webhook Secrets
Generate two random secrets (32+ characters each):

**Option A: Using openssl**
```bash
# Production secret
openssl rand -hex 32

# Dev secret  
openssl rand -hex 32
```

**Option B: Using Node.js**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Save both secrets** - you'll need them later.

---

## Cloudflare Setup

### 1. Create Two Workers in Cloudflare Dashboard

#### Worker 1: Production (flights)
1. Go to Cloudflare Dashboard → Workers & Pages
2. Click "Create Application" → "Create Worker"
3. Name: `flights`
4. Click "Deploy"
5. Go to Settings → Triggers
6. Note the URL: `https://flights.your-account.workers.dev`

#### Worker 2: Development (flights-dev)
1. Click "Create Application" → "Create Worker"
2. Name: `flights-dev`
3. Click "Deploy"
4. Go to Settings → Triggers
5. Note the URL: `https://flights-dev.your-account.workers.dev`

### 2. Connect Workers to Git

#### For Production Worker (flights)
1. Go to worker → Settings → Builds & Deployments
2. Click "Connect to Git"
3. Select your repository
4. **Branch**: `main`
5. **Build command**: (leave default or empty)
6. **Deploy command**: (leave default)
7. Save

#### For Development Worker (flights-dev)
1. Go to worker → Settings → Builds & Deployments
2. Click "Connect to Git"
3. Select same repository
4. **Branch**: `dev`
5. **Build command**: (leave default or empty)
6. **Deploy command**: Make sure it includes `--env dev`
   - If there's a field for deployment flags, add: `--env dev`
   - Or in custom deploy command: `wrangler deploy --env dev`
7. Save

### 3. Set Secrets for Production Worker

1. Go to `flights` worker → Settings → Variables and Secrets
2. Add these secrets:

**BOT_TOKEN**
- Type: Secret
- Value: (paste your **production** bot token from BotFather)

**WEBHOOK_SECRET**
- Type: Secret
- Value: (paste your **production** webhook secret you generated)

**ADMIN_CHAT_IDS**
- Type: Secret
- Value: (paste your admin chat ID, e.g., `987654321`)
- Note: If multiple admins, comma-separate: `987654321,123456789`

### 4. Set Secrets for Dev Worker

1. Go to `flights-dev` worker → Settings → Variables and Secrets
2. Add these secrets:

**BOT_TOKEN**
- Type: Secret
- Value: (paste your **dev** bot token from BotFather)

**WEBHOOK_SECRET**
- Type: Secret
- Value: (paste your **dev** webhook secret you generated)

**ADMIN_CHAT_IDS**
- Type: Secret  
- Value: (same as production - your admin chat ID)

---

## Git Setup

### 1. Create Dev Branch
```bash
cd /Users/p/dev/flights
git checkout -b dev
git push -u origin dev
```

This creates the dev branch that the dev worker will track.

---

## After Code is Deployed (Phase 5)

### 1. Set Webhook for Development Bot

Use the **dev** bot token and **dev** webhook secret:

```bash
curl -X POST "https://api.telegram.org/bot<DEV_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://flights-dev.your-account.workers.dev/webhook",
    "secret_token": "<DEV_WEBHOOK_SECRET>"
  }'
```

Expected response:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

### 2. Verify Dev Webhook
```bash
curl "https://api.telegram.org/bot<DEV_BOT_TOKEN>/getWebhookInfo"
```

Should show:
- `url`: Your dev worker URL
- `has_custom_certificate`: false
- `pending_update_count`: 0

### 3. Set Webhook for Production Bot

Use the **production** bot token and **production** webhook secret:

```bash
curl -X POST "https://api.telegram.org/bot<PROD_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://flights.your-account.workers.dev/webhook",
    "secret_token": "<PROD_WEBHOOK_SECRET>"
  }'
```

### 4. Verify Production Webhook
```bash
curl "https://api.telegram.org/bot<PROD_BOT_TOKEN>/getWebhookInfo"
```

---

## Testing Checklist

### Dev Bot Testing
1. [ ] Open Telegram, find your dev bot
2. [ ] Send `/start` - should receive approval request message
3. [ ] Check admin account - should receive approval notification
4. [ ] Click "Approve" button
5. [ ] User should receive approval confirmation
6. [ ] Send `/status` - should work
7. [ ] Send `/track LY086` - should work
8. [ ] Spam 15 commands rapidly - should get rate limited

### Production Bot Testing (after merging to main)
1. [ ] Open Telegram, find your production bot
2. [ ] Repeat same tests as dev
3. [ ] Verify production bot has separate data from dev

---

## Troubleshooting

### Webhook Not Working
1. Check webhook URL is correct: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
2. Verify secret is set correctly in Cloudflare worker settings
3. Check Cloudflare worker logs: Dashboard → Worker → Logs

### Bot Not Responding
1. Check worker is deployed: Visit worker URL in browser
2. Check secrets are set: Cloudflare Dashboard → Worker → Settings → Variables
3. Check webhook is set: `getWebhookInfo` API call
4. Check worker logs for errors

### Auto-Deployment Not Working
1. Verify Git connection: Cloudflare Dashboard → Worker → Settings → Builds
2. Check branch name matches (main vs dev)
3. Check recent deployments: Worker → Deployments tab
4. Manually trigger deployment: Push an empty commit

### Rate Limiting Too Strict
Temporarily increase limits in `src/middleware/rateLimit.ts`:
```typescript
const USER_LIMIT = 20  // was 10
const IP_LIMIT = 100   // was 50
```

---

## Quick Reference

### Your Configuration (fill this in)

**Production Bot**
- Token: `_______________`
- Webhook Secret: `_______________`
- Worker URL: `https://flights.your-account.workers.dev`

**Dev Bot**
- Token: `_______________`
- Webhook Secret: `_______________`
- Worker URL: `https://flights-dev.your-account.workers.dev`

**Admin**
- Chat ID: `_______________`

**Git Branches**
- Production: `main`
- Development: `dev`
