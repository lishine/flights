# Major Refactor: Grammy Bot with Security (Oct 2, 2025)

Complete migration from raw Telegram API calls to Grammy framework with comprehensive security measures and user approval system.

---

## 📁 Documentation Structure

### Quick Start
1. **READ FIRST**: `instructions.md` - Manual setup steps you need to do
2. **OVERVIEW**: `phases.md` - Summary of all implementation phases
3. **DETAILS**: `plan.md` - Complete technical specification

### Implementation Phases (for AI)
Each phase is designed for a single AI session with clear acceptance criteria:

- **Phase 1** (30 min): Environment Setup - wrangler.toml, dependencies, env vars
- **Phase 2** (1 hour): Security Infrastructure - webhook validation, rate limiting, admin auth
- **Phase 3** (2 hours): Grammy Integration - migrate all commands to Grammy
- **Phase 4** (1.5 hours): Approval System - user approval flow with admin controls
- **Phase 5** (1 hour): Testing & Deployment - comprehensive testing and go-live

**Total Time**: ~6 hours

---

## 🎯 Goals

### Primary Objectives
✅ Replace raw `ofetch` Telegram API calls with Grammy framework  
✅ Implement webhook secret token validation  
✅ Add rate limiting (per-user and per-IP)  
✅ Create user approval system with admin controls  
✅ Separate dev/prod environments for safe testing  

### Secondary Benefits
- Cleaner, more maintainable code
- Type-safe bot commands
- Better error handling
- Easier to add new features
- Production-ready security

---

## 🔐 Security Features

1. **Webhook Secret Validation**
   - Validates `X-Telegram-Bot-Api-Secret-Token` header
   - Uses constant-time comparison to prevent timing attacks
   - Rejects unauthorized webhook requests (403)

2. **Rate Limiting**
   - Per-user: 10 commands/minute
   - Per-IP: 50 requests/minute
   - Stored in Durable Object SQL
   - Prevents spam and DDoS attacks

3. **User Approval System**
   - New users must be approved by admin
   - Admin receives notification with approve/reject buttons
   - Status tracked in database (pending/approved/rejected)
   - Users notified of approval status

4. **Admin Authorization**
   - Admin-only commands protected
   - Admin chat IDs stored in environment variable
   - Separate admin middleware

5. **Input Sanitization**
   - Flight codes validated (max 10 chars, alphanumeric)
   - Markdown escaping for user input
   - Callback data format validation

---

## 🌍 Environment Separation

### Production
- Worker: `flights.workers.dev`
- Git branch: `main`
- Bot: Production Telegram bot
- Durable Object: Production database
- Auto-deploys on push to main

### Development
- Worker: `flights-dev.workers.dev`
- Git branch: `dev`
- Bot: Development Telegram bot (separate)
- Durable Object: Dev database (isolated)
- Auto-deploys on push to dev

**Key Benefit**: Break things in dev without affecting production!

---

## 📦 What Changes

### New Dependencies
- `grammy` - Modern Telegram Bot framework

### New Files
```
src/
├── services/
│   ├── bot.ts                 # Grammy bot instance
│   ├── userApprovals.ts       # Approval CRUD operations
│   └── adminNotifications.ts  # Admin approval alerts
└── middleware/
    ├── approval.ts            # Check user approved
    ├── rateLimit.ts           # Rate limiting enforcement
    └── admin.ts               # Admin-only filter
```

### Modified Files
- `wrangler.toml` - Add dev environment
- `env.ts` - Add WEBHOOK_SECRET, ADMIN_CHAT_IDS
- `schema.ts` - Add user_approvals, rate_limits tables
- `index.ts` - Add webhook secret validation
- `durable.ts` - Integrate Grammy, rate limiting
- `handlers/commands.ts` - Migrate to Grammy syntax
- `services/telegram.ts` - Simplify using Grammy

### Database Changes
New tables:
- `user_approvals` - Track user approval status
- `rate_limits` - Store rate limit counters

---

## 🚀 How to Use

### For You (Manual Steps)
1. Create dev bot via BotFather
2. Set secrets in Cloudflare dashboard
3. Create dev branch in Git
4. Follow `instructions.md` for detailed setup

### For AI (Code Changes)
Work through phases 1-5 in order:
1. Each phase has clear objectives
2. Run acceptance criteria before moving on
3. Can rollback individual phases if needed

---

## ✅ Success Criteria

After Phase 5 completion, verify:

- [ ] Grammy framework integrated completely
- [ ] All security measures implemented
- [ ] User approval system works end-to-end
- [ ] Dev/prod environments fully separated
- [ ] All existing commands still functional
- [ ] Rate limiting prevents spam
- [ ] Webhook secret validates all requests
- [ ] Admin-only commands protected
- [ ] Code is cleaner and more maintainable
- [ ] No errors in production logs

---

## 📚 Reference Documents

- `plan.md` - Complete technical architecture and design decisions
- `instructions.md` - Step-by-step manual setup guide
- `phases.md` - Quick phase overview
- `phase1.md` through `phase5.md` - Detailed implementation per phase

---

## 🔄 Workflow

```
1. You: Follow instructions.md to set up bots and secrets
2. AI: Implement Phase 1 (environment setup)
3. AI: Implement Phase 2 (security)
4. AI: Implement Phase 3 (Grammy migration)
5. AI: Implement Phase 4 (approval system)
6. You + AI: Phase 5 (testing & deployment)
```

---

## 💡 Tips

- **Start with dev branch**: All changes go to dev first
- **Test thoroughly**: Use dev bot to test everything
- **Check logs**: `wrangler tail --env dev` to debug
- **Reset database**: Use `/reset-schema` endpoint if needed
- **Production last**: Only merge to main when dev works perfectly

---

## 🆘 Support

If stuck:
1. Check `instructions.md` for setup issues
2. Review acceptance criteria in each phase
3. Use rollback steps if needed
4. Check Cloudflare worker logs
5. Verify secrets are set correctly

---

## 📊 Estimated Timeline

- **Setup** (you): 30 minutes
- **Phase 1-4** (AI): 5 hours  
- **Phase 5** (testing): 1 hour
- **Total**: ~6.5 hours

---

Good luck with the refactor! 🚀
