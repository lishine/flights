# Implementation Phases Overview

## Phase 1: Environment Setup (30 min)
**Goal**: Prepare dev/prod separation and install dependencies

- Update wrangler.toml with dev environment
- Install Grammy and dependencies
- Update env.ts interface
- Update package.json scripts

**Acceptance Criteria**:
- ✅ `wrangler deploy --env dev` works
- ✅ Grammy installed in node_modules
- ✅ TypeScript compiles without errors

---

## Phase 2: Security Infrastructure (1 hour)
**Goal**: Implement all security measures before touching bot logic

- Webhook secret validation
- Rate limiting implementation
- Admin authorization helpers
- Input sanitization utilities
- Database schema for rate limits

**Acceptance Criteria**:
- ✅ Webhook rejects requests without valid secret
- ✅ Rate limits enforce per-user and per-IP restrictions
- ✅ Admin-only functions throw for non-admins
- ✅ All user inputs validated

---

## Phase 3: Grammy Integration (2 hours)
**Goal**: Replace raw Telegram API calls with Grammy

- Create bot service (src/services/bot.ts)
- Refactor all command handlers to Grammy syntax
- Implement middleware (approval, rate limit, admin)
- Update webhook handler to use bot.handleUpdate()
- Remove ofetch Telegram API calls

**Acceptance Criteria**:
- ✅ All commands work via Grammy
- ✅ Callback queries handled by Grammy
- ✅ No direct Telegram API calls except via Grammy
- ✅ Middleware properly filters requests

---

## Phase 4: Approval System (1.5 hours)
**Goal**: Add user approval flow for new users

- Add user_approvals table to schema
- Create approval CRUD operations
- Build admin notification service
- Implement /start with approval logic
- Add approve/reject callback handlers

**Acceptance Criteria**:
- ✅ New users get "pending approval" message
- ✅ Admin receives approval request with buttons
- ✅ Approval/rejection works end-to-end
- ✅ Approved users can use all commands

---

## Phase 5: Testing & Deployment (1 hour)
**Goal**: Verify everything works in dev, then deploy to production

- Test all commands locally
- Deploy to dev environment
- Configure dev webhook with secret
- Test approval flow end-to-end
- Test rate limiting
- Deploy to production
- Configure production webhook

**Acceptance Criteria**:
- ✅ Dev bot fully functional
- ✅ All existing commands work
- ✅ Approval system works
- ✅ Rate limits trigger correctly
- ✅ Production deployed without errors

---

## Total Time Estimate: ~6 hours

## Rollback Plan
Each phase is independent - if something breaks:
1. Revert to previous commit
2. Fix issues in dev branch
3. Test again before merging to main

## Dependencies Between Phases
- Phase 1 must complete before others (foundation)
- Phase 2 should complete before Phase 3 (security first)
- Phase 3 must complete before Phase 4 (Grammy needed for approval handlers)
- Phase 5 is final (testing & deployment)
