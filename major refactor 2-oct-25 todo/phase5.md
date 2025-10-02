# Phase 5: Testing & Deployment

**Estimated Time**: 1 hour  
**Goal**: Verify everything works, deploy to dev and production

---

## Prerequisites

Before starting this phase, ensure:
- [ ] You have created dev bot via BotFather
- [ ] You have set secrets in Cloudflare (see instructions.md)
- [ ] You have created dev branch in Git
- [ ] Phases 1-4 completed successfully

---

## Testing Checklist

### Step 1: Local Testing (Optional)

```bash
cd workers

# Run local dev server
wrangler dev --env dev
```

This starts local server but won't receive Telegram webhooks (use ngrok if needed).

---

### Step 2: Deploy to Dev Environment

```bash
# Make sure you're in dev branch
git checkout dev

# Add all changes
git add -A

# Commit
git commit -m "Refactor: Grammy integration with security and approval system

- Migrated from raw Telegram API to Grammy framework
- Added webhook secret validation
- Implemented rate limiting (per-user and per-IP)
- Added user approval system with admin controls
- Enhanced security with input sanitization
- Separated dev/prod environments

Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"

# Push to dev branch (triggers auto-deployment)
git push origin dev
```

Wait for Cloudflare to deploy (check dashboard).

---

### Step 3: Set Dev Webhook

**Important**: Replace placeholders with your actual values!

```bash
# Set webhook with secret
curl -X POST "https://api.telegram.org/bot<YOUR_DEV_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://flights-dev.your-account.workers.dev/webhook",
    "secret_token": "<YOUR_DEV_WEBHOOK_SECRET>"
  }'
```

Expected response:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

Verify webhook:
```bash
curl "https://api.telegram.org/bot<YOUR_DEV_BOT_TOKEN>/getWebhookInfo"
```

Should show your webhook URL.

---

### Step 4: Manual Testing in Dev

Open Telegram, find your dev bot, and test:

#### Test 1: First User (Approval Flow)
1. [ ] Send `/start`
   - **Expected**: "Your access request has been sent to admin..."
2. [ ] Check admin account
   - **Expected**: Receive approval notification with buttons
3. [ ] Click "Approve" button
   - **Expected**: User receives "Your access has been approved!"
4. [ ] User sends `/start` again
   - **Expected**: "Welcome! You have access..."

#### Test 2: Commands Work
1. [ ] Send `/help`
   - **Expected**: List of commands
2. [ ] Send `/status`
   - **Expected**: System status with buttons
3. [ ] Send `/track LY086`
   - **Expected**: "Now tracking LY086" or "Flight not found"
4. [ ] Send `/clear_tracked`
   - **Expected**: Confirmation message

#### Test 3: Callback Buttons
1. [ ] Send `/status`
2. [ ] Click "View Tracked Flights"
   - **Expected**: Shows your tracked flights
3. [ ] Click "Show Flight Suggestions"
   - **Expected**: Shows suggested flights
4. [ ] Click "Refresh Status"
   - **Expected**: Status updates

#### Test 4: Rate Limiting
1. [ ] Send 15 commands rapidly (any command)
   - **Expected**: After 10th command, start getting rate limited
   - **Expected**: Wait 60 seconds, commands work again

#### Test 5: Admin Commands
1. [ ] As admin, send `/test`
   - **Expected**: "Added X test flights..."
2. [ ] As non-admin user, send `/test`
   - **Expected**: "Admin only command"

#### Test 6: Webhook Secret Validation
Test with invalid secret (advanced):
```bash
# Send fake update with wrong secret
curl -X POST "https://flights-dev.your-account.workers.dev/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: wrong_secret" \
  -d '{"message": {"chat": {"id": 123}}}'
```
- **Expected**: 403 Forbidden response

---

### Step 5: Reset Dev Database (if needed)

If you need to test approval flow again or reset data:

```bash
# Reset schema via HTTP endpoint
curl "https://flights-dev.your-account.workers.dev/reset-schema"
```

This clears all data including approvals. Test /start flow again.

---

### Step 6: Deploy to Production

Once dev testing is complete and everything works:

```bash
# Switch to main branch
git checkout main

# Merge dev into main
git merge dev

# Push to main (triggers production deployment)
git push origin main
```

Wait for Cloudflare to deploy production.

---

### Step 7: Set Production Webhook

```bash
# Set webhook with secret
curl -X POST "https://api.telegram.org/bot<YOUR_PROD_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://flights.your-account.workers.dev/webhook",
    "secret_token": "<YOUR_PROD_WEBHOOK_SECRET>"
  }'
```

Verify:
```bash
curl "https://api.telegram.org/bot<YOUR_PROD_BOT_TOKEN>/getWebhookInfo"
```

---

### Step 8: Production Smoke Test

Open Telegram, find your production bot:

1. [ ] Send `/start` - verify approval flow
2. [ ] Admin approves
3. [ ] Send `/status` - verify it works
4. [ ] Test one or two other commands

---

## Verification

### Check Logs

**Dev Environment**:
```bash
wrangler tail --env dev
```

**Production**:
```bash
wrangler tail
```

Look for:
- ✅ No errors in logs
- ✅ Rate limiting triggers correctly
- ✅ Commands execute successfully
- ✅ Approval notifications sent

---

## Common Issues & Solutions

### Issue: Bot not responding
**Check**:
1. Webhook set correctly? `getWebhookInfo`
2. Secrets configured in Cloudflare?
3. Worker deployed successfully?
4. Check worker logs: `wrangler tail --env dev`

**Solution**: 
- Re-set webhook with correct secret
- Verify secrets in CF dashboard
- Check deployment status

---

### Issue: "Forbidden" error
**Cause**: Webhook secret mismatch

**Solution**:
1. Check WEBHOOK_SECRET in Cloudflare matches what you set in setWebhook
2. Re-set webhook with correct secret

---

### Issue: Rate limiting too aggressive
**Temporary fix**: Edit `workers/src/middleware/rateLimit.ts`:
```typescript
const USER_LIMIT: RateLimitConfig = {
	maxRequests: 20,  // was 10
	windowSeconds: 60
}
```
Redeploy to dev, test, adjust as needed.

---

### Issue: Admin not receiving approval notifications
**Check**:
1. ADMIN_CHAT_IDS set correctly in Cloudflare secrets?
2. Format: `123456789` or `123456789,987654321` for multiple admins
3. Check worker logs for errors

**Solution**:
- Verify admin chat ID is correct
- Use @userinfobot to get your chat ID
- Update secret in Cloudflare dashboard

---

### Issue: Existing users can't use bot
**Cause**: They need approval now

**Solution**: 
Option 1: Manually approve all in database (SQL)
Option 2: Temporarily bypass approval for testing
Option 3: Have each user send /start and approve them

---

## Performance Checks

### Response Time
Commands should respond within 1-2 seconds.

### Rate Limit Performance
Should handle burst of 50 requests without blocking legitimate users.

### Memory Usage
Check Cloudflare dashboard - should be well under limits.

---

## Final Checklist

- [ ] Dev environment fully tested
- [ ] All commands work in dev
- [ ] Approval flow works end-to-end
- [ ] Rate limiting triggers correctly
- [ ] Admin commands protected
- [ ] Production deployed successfully
- [ ] Production webhook configured
- [ ] Production bot tested
- [ ] Logs show no errors
- [ ] Both bots (dev/prod) have separate data

---

## Success Criteria

✅ Grammy framework fully integrated  
✅ All existing functionality preserved  
✅ Webhook secret validation working  
✅ Rate limiting prevents spam  
✅ User approval system functional  
✅ Admin-only commands protected  
✅ Dev/prod environments isolated  
✅ No errors in production logs  
✅ Code is cleaner and more maintainable  

---

## Post-Deployment Monitoring

### First 24 Hours
- Monitor logs for errors: `wrangler tail`
- Watch for rate limit false positives
- Verify cron jobs still run (check flight updates)
- Ensure alerts sent successfully

### First Week
- Monitor user feedback
- Adjust rate limits if needed
- Fine-tune approval messages if users confused
- Check for any performance issues

---

## Rollback Plan

If critical issues in production:

```bash
# Revert to previous commit
git checkout main
git reset --hard HEAD~1
git push --force origin main
```

Cloudflare will auto-deploy previous version.

**Note**: This loses all approvals data. Only use in emergencies.

---

## Next Steps (Future Enhancements)

Consider adding:
- [ ] Auto-approve trusted users (e.g., from whitelist)
- [ ] Approval expiry (re-approve after X days)
- [ ] User analytics (track most used commands)
- [ ] Bulk approval management commands
- [ ] Approval notifications via email/Slack

---

## Congratulations! 🎉

You've successfully:
- Migrated to Grammy framework
- Implemented comprehensive security
- Added user approval system
- Set up dev/prod environments
- Deployed and tested everything

Your flight tracking bot is now more secure, maintainable, and scalable!
