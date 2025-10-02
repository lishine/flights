# Complete Technical Plan: Grammy Bot Refactor with Security

## Overview
Migrate from raw Telegram API calls (ofetch) to Grammy framework with comprehensive security measures and user approval system. Implement dev/prod environment separation for safe development.

---

## Architecture Changes

### Before
```
Telegram → Webhook → Worker → ofetch → Telegram API
                  ↓
           Durable Object (SQL)
```

### After
```
Telegram → Webhook (secret validated) → Rate Limiter → Worker → Grammy Bot
                                                           ↓
                                              Durable Object (SQL + approvals)
```

---

## Key Technologies

### Grammy Framework
- **Purpose**: Modern Telegram Bot framework for TypeScript
- **Benefits**: 
  - Type-safe API
  - Middleware system
  - Built-in error handling
  - Cleaner command/callback handling
  - Works on Cloudflare Workers (edge-ready)

### Security Layers
1. **Webhook Secret Token**: Validates requests from Telegram
2. **Rate Limiting**: Prevents spam/DDoS (per-user + per-IP)
3. **User Approval System**: Admin must approve new users
4. **Admin Authorization**: Protects sensitive commands
5. **Input Sanitization**: Validates all user inputs

---

## Environment Separation

### Two Environments
1. **Production** (main branch)
   - Worker: `flights.workers.dev`
   - Bot: Production Telegram bot
   - Durable Object: Production database
   - Secrets: Production tokens

2. **Development** (dev branch)
   - Worker: `flights-dev.workers.dev`
   - Bot: Development Telegram bot
   - Durable Object: Dev database (isolated)
   - Secrets: Dev tokens

### Deployment Flow
```
dev branch → push → Cloudflare auto-deploys → flights-dev.workers.dev
main branch → push → Cloudflare auto-deploys → flights.workers.dev
```

---

## Database Schema Changes

### New Table: user_approvals
```sql
CREATE TABLE IF NOT EXISTS user_approvals (
  chat_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
  requested_at INTEGER NOT NULL,
  approved_at INTEGER,
  approved_by INTEGER,
  username TEXT,
  first_name TEXT,
  last_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_approval_status ON user_approvals(status);
```

### Existing Tables (unchanged)
- `flights` - Flight data
- `subscriptions` - User tracking
- `status` - System metadata

---

## Security Implementation Details

### 1. Webhook Secret Validation
**Location**: `src/index.ts` (main webhook handler)

```typescript
const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
const expectedSecret = env.WEBHOOK_SECRET

if (!secretToken || !crypto.timingSafeEqual(
  Buffer.from(secretToken),
  Buffer.from(expectedSecret)
)) {
  return new Response('Forbidden', { status: 403 })
}
```

**Why**: Ensures only Telegram can send updates to webhook

### 2. Rate Limiting
**Location**: `src/middleware/rateLimit.ts`

**Limits**:
- Per user: 10 commands/minute
- Per IP: 50 requests/minute

**Storage**: Durable Object SQL
```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER,
  reset_at INTEGER
);
```

**Algorithm**: Token bucket / sliding window

### 3. Admin Authorization
**Location**: `src/middleware/admin.ts`

```typescript
export const isAdmin = (chatId: number, env: Env): boolean => {
  const adminIds = env.ADMIN_CHAT_IDS.split(',').map(id => parseInt(id.trim()))
  return adminIds.includes(chatId)
}

export const adminOnly = async (ctx: Context, next: NextFunction) => {
  if (!isAdmin(ctx.from?.id, ctx.env)) {
    await ctx.reply('❌ Admin only command')
    return
  }
  await next()
}
```

### 4. Input Sanitization
**Location**: `src/utils/validation.ts`

- Flight codes: max 10 chars, alphanumeric only
- Callback data: validated format
- Markdown escaping for user-provided strings

---

## Grammy Integration

### Command Structure Migration

**Before (manual parsing)**:
```typescript
if (text.startsWith('/track')) {
  const args = text.split(' ').slice(1)
  // handle tracking...
}
```

**After (Grammy)**:
```typescript
bot.command('track', approvalMiddleware, async (ctx) => {
  const args = ctx.match.split(' ')
  // handle tracking...
})
```

### Middleware Chain
```
Request → Webhook Secret Check → Rate Limit → Approval Check → Admin Check → Command Handler
```

### Bot Service Architecture
```typescript
// src/services/bot.ts
export const createBot = (env: Env) => {
  const bot = new Bot(env.BOT_TOKEN)
  
  // Global middleware
  bot.use(rateLimitMiddleware)
  
  // Commands
  setupCommands(bot)
  
  // Error handling
  bot.catch(errorHandler)
  
  return bot
}
```

---

## Approval System Flow

### New User Journey
1. User clicks bot link or sends `/start`
2. Bot checks if user exists in `user_approvals`
3. If not exists:
   - Create pending approval record
   - Send notification to all admins
   - Reply to user: "⏳ Awaiting approval..."
4. Admin receives message with buttons: [✅ Approve] [❌ Reject]
5. Admin clicks Approve:
   - Update status to 'approved'
   - Send welcome message to user
   - Update admin message to show "APPROVED"
6. User can now use all commands

### Admin Notification Format
```markdown
🔔 New User Approval Request

👤 Name: John Doe
🆔 Username: @johndoe
🔢 User ID: 123456789
🔗 [Profile](tg://user?id=123456789)
```
Buttons: [✅ Approve] [❌ Reject]

---

## File Structure Changes

### New Files
```
src/
├── services/
│   ├── bot.ts                 # Grammy bot instance & setup
│   ├── adminNotifications.ts  # Admin approval alerts
│   └── userApprovals.ts       # Approval CRUD operations
├── middleware/
│   ├── approval.ts            # Check user approved before commands
│   ├── rateLimit.ts           # Rate limiting enforcement
│   └── admin.ts               # Admin-only command filter
└── utils/
    └── security.ts            # Webhook validation, crypto helpers
```

### Modified Files
```
src/
├── index.ts              # Add webhook secret validation
├── durable.ts            # Integrate Grammy bot
├── schema.ts             # Add user_approvals table
├── env.ts                # Add new environment variables
└── handlers/
    └── commands.ts       # Convert to Grammy syntax
```

---

## Environment Variables

### env.ts Interface
```typescript
export interface Env {
  BOT_TOKEN: string
  WEBHOOK_SECRET: string
  ADMIN_CHAT_IDS: string  // comma-separated: "123,456,789"
  FLIGHTS_DO: DurableObjectNamespace
}
```

### Setting Secrets
```bash
# Production
wrangler secret put BOT_TOKEN
wrangler secret put WEBHOOK_SECRET
wrangler secret put ADMIN_CHAT_IDS

# Development
wrangler secret put BOT_TOKEN --env dev
wrangler secret put WEBHOOK_SECRET --env dev
wrangler secret put ADMIN_CHAT_IDS --env dev
```

---

## Command Changes

### New Commands
- `/start` - Now triggers approval flow for new users

### Protected Commands (admin-only)
- `/test` - Add test data
- `/reset-schema` - Reset database (via HTTP, not Telegram)

### Existing Commands (unchanged functionality)
- `/track <flights>` - Track flights
- `/status` - System status
- `/clear_tracked` - Clear user subscriptions
- All callback queries for buttons

---

## Testing Strategy

### Local Testing
```bash
wrangler dev --env dev
# Test with dev bot
```

### Dev Environment Testing
```bash
git push origin dev
# Test deployed dev worker
# Verify:
# - Webhook secret validation
# - Rate limiting
# - Approval flow
# - All existing commands
```

### Production Deployment
```bash
git checkout main
git merge dev
git push origin main
# Cloudflare auto-deploys
```

---

## Migration Checklist

- [ ] Phase 1: Environment setup
- [ ] Phase 2: Security infrastructure
- [ ] Phase 3: Grammy integration
- [ ] Phase 4: Approval system
- [ ] Phase 5: Testing & deployment

---

## Rollback Strategy

### If Issues in Dev
1. Fix in dev branch
2. Test locally with `wrangler dev --env dev`
3. Push to dev branch, verify deployed
4. Once stable, merge to main

### If Issues in Production
1. Revert main branch to previous commit
2. Cloudflare auto-deploys previous version
3. Fix issues in dev branch
4. Test thoroughly before re-deploying to main

---

## Success Criteria

✅ Grammy framework integrated completely
✅ All security measures implemented
✅ User approval system works end-to-end
✅ Dev/prod environments fully separated
✅ All existing commands still functional
✅ Rate limiting prevents spam
✅ Webhook secret validates all requests
✅ Admin-only commands protected
✅ Code is cleaner and more maintainable
