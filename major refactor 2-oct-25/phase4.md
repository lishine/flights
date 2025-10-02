# Phase 4: Approval System

**Estimated Time**: 1.5 hours  
**Goal**: Add user approval flow for new users

---

## Changes in This Phase

### 1. Update Database Schema

**File**: `workers/src/schema.ts`

Add user approvals table:

```typescript
export const initializeSchema = (ctx: DurableObjectState) => {
	// ... existing tables (flights, subscriptions, status, rate_limits)
	
	// NEW: User approvals table
	ctx.storage.sql.exec(`
		CREATE TABLE IF NOT EXISTS user_approvals (
			chat_id INTEGER PRIMARY KEY,
			status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
			requested_at INTEGER NOT NULL,
			approved_at INTEGER,
			approved_by INTEGER,
			username TEXT,
			first_name TEXT,
			last_name TEXT
		)
	`)
	
	ctx.storage.sql.exec(`
		CREATE INDEX IF NOT EXISTS idx_approval_status ON user_approvals(status);
	`)
}

export const resetSchema = (ctx: DurableObjectState) => {
	ctx.storage.sql.exec(`DROP TABLE IF EXISTS subscriptions`)
	ctx.storage.sql.exec(`DROP TABLE IF EXISTS flights`)
	ctx.storage.sql.exec(`DROP TABLE IF EXISTS status`)
	ctx.storage.sql.exec(`DROP TABLE IF EXISTS rate_limits`)
	ctx.storage.sql.exec(`DROP TABLE IF EXISTS user_approvals`)

	initializeSchema(ctx)
}
```

---

### 2. Create User Approvals Service

**File**: `workers/src/services/userApprovals.ts` (NEW)

```typescript
import type { DurableObjectState } from 'cloudflare:workers'
import type { User } from 'typegram'

export interface UserApproval {
	chat_id: number
	status: 'pending' | 'approved' | 'rejected'
	requested_at: number
	approved_at?: number
	approved_by?: number
	username?: string
	first_name?: string
	last_name?: string
}

/**
 * Get user approval status
 */
export const getUserApproval = (chatId: number, ctx: DurableObjectState): UserApproval | null => {
	const result = ctx.storage.sql.exec(
		'SELECT * FROM user_approvals WHERE chat_id = ?',
		chatId
	).one() as UserApproval | undefined
	
	return result || null
}

/**
 * Create pending approval for new user
 */
export const createPendingApproval = (chatId: number, user: User, ctx: DurableObjectState): void => {
	const now = Math.floor(Date.now() / 1000)
	
	ctx.storage.sql.exec(
		`INSERT INTO user_approvals (chat_id, status, requested_at, username, first_name, last_name)
		 VALUES (?, 'pending', ?, ?, ?, ?)
		 ON CONFLICT(chat_id) DO UPDATE SET
		   status = 'pending',
		   requested_at = ?,
		   username = ?,
		   first_name = ?,
		   last_name = ?`,
		chatId,
		now,
		user.username || null,
		user.first_name || null,
		user.last_name || null,
		now,
		user.username || null,
		user.first_name || null,
		user.last_name || null
	)
}

/**
 * Approve user
 */
export const approveUser = (chatId: number, approvedBy: number, ctx: DurableObjectState): void => {
	const now = Math.floor(Date.now() / 1000)
	
	ctx.storage.sql.exec(
		`UPDATE user_approvals 
		 SET status = 'approved', approved_at = ?, approved_by = ?
		 WHERE chat_id = ?`,
		now,
		approvedBy,
		chatId
	)
}

/**
 * Reject user
 */
export const rejectUser = (chatId: number, rejectedBy: number, ctx: DurableObjectState): void => {
	const now = Math.floor(Date.now() / 1000)
	
	ctx.storage.sql.exec(
		`UPDATE user_approvals 
		 SET status = 'rejected', approved_at = ?, approved_by = ?
		 WHERE chat_id = ?`,
		now,
		rejectedBy,
		chatId
	)
}

/**
 * Check if user is approved
 */
export const isUserApproved = (chatId: number, ctx: DurableObjectState): boolean => {
	const approval = getUserApproval(chatId, ctx)
	return approval?.status === 'approved'
}
```

---

### 3. Create Admin Notification Service

**File**: `workers/src/services/adminNotifications.ts` (NEW)

```typescript
import { Bot } from 'grammy'
import type { User } from 'typegram'
import type { Env } from '../env'

/**
 * Send approval request notification to all admins
 */
export const notifyAdminForApproval = async (user: User, env: Env, bot: Bot): Promise<void> => {
	const adminIds = env.ADMIN_CHAT_IDS.split(',').map(id => parseInt(id.trim()))
	
	const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ')
	const username = user.username ? `@${user.username}` : 'N/A'
	
	const message = 
		`🔔 *New User Approval Request*\n\n` +
		`👤 Name: ${displayName}\n` +
		`🆔 Username: ${username}\n` +
		`🔢 User ID: \`${user.id}\`\n` +
		`🔗 [Profile](tg://user?id=${user.id})`
	
	const keyboard = {
		inline_keyboard: [[
			{ text: '✅ Approve', callback_data: `approve_${user.id}` },
			{ text: '❌ Reject', callback_data: `reject_${user.id}` }
		]]
	}
	
	for (const adminId of adminIds) {
		try {
			await bot.api.sendMessage(adminId, message, { 
				parse_mode: 'Markdown',
				reply_markup: keyboard 
			})
		} catch (error) {
			console.error(`Failed to notify admin ${adminId}:`, error)
		}
	}
}
```

---

### 4. Create Approval Middleware

**File**: `workers/src/middleware/approval.ts` (NEW)

```typescript
import type { Context } from 'grammy'
import type { DurableObjectState } from 'cloudflare:workers'
import { getUserApproval, createPendingApproval } from '../services/userApprovals'
import { notifyAdminForApproval } from '../services/adminNotifications'
import { isAdminUser } from './admin'
import type { Env } from '../env'

/**
 * Middleware to check if user is approved
 * Allows /start command for everyone
 * Admins bypass approval check
 */
export const createApprovalMiddleware = (ctx: DurableObjectState, env: Env, bot: any) => {
	return async (gramCtx: Context, next: () => Promise<void>) => {
		const chatId = gramCtx.from?.id
		
		if (!chatId) {
			await gramCtx.reply('❌ Unable to identify user')
			return
		}
		
		// Admin bypass
		if (isAdminUser(chatId, env)) {
			return next()
		}
		
		// Allow /start command for everyone (needed for approval flow)
		const message = gramCtx.message
		if (message && 'text' in message && message.text === '/start') {
			return next()
		}
		
		// Check approval status
		const approval = getUserApproval(chatId, ctx)
		
		if (!approval) {
			// First time user - already handled in /start command
			await gramCtx.reply('⏳ Please send /start to request access.')
			return
		}
		
		if (approval.status === 'pending') {
			await gramCtx.reply('⏳ Your request is pending admin approval. Please wait.')
			return
		}
		
		if (approval.status === 'rejected') {
			await gramCtx.reply('❌ Your access request was denied.')
			return
		}
		
		// User is approved
		return next()
	}
}
```

---

### 5. Update Command Handlers with Approval Logic

**File**: `workers/src/handlers/commands.ts`

Update the setupCommands function to include approval:

```typescript
export const setupCommands = (bot: Bot, ctx: DurableObjectState, env: Env) => {
	// Create approval middleware
	const approvalMiddleware = createApprovalMiddleware(ctx, env, bot)
	
	// Apply approval middleware to all commands except those that should always work
	// (Approval middleware internally allows /start)
	bot.use(approvalMiddleware)
	
	// ... existing buildStatusMessage function
	
	// /start command - UPDATED for approval flow
	bot.command('start', async (gramCtx) => {
		const chatId = gramCtx.from?.id
		const user = gramCtx.from
		
		if (!chatId || !user) {
			await gramCtx.reply('❌ Unable to identify user')
			return
		}
		
		// Admin bypass
		if (isAdminUser(chatId, env)) {
			await gramCtx.reply('👑 *Welcome, Admin!*\n\nYou have full access to all commands.', { parse_mode: 'Markdown' })
			return
		}
		
		// Check approval status
		const approval = getUserApproval(chatId, ctx)
		
		if (!approval) {
			// New user - create pending approval
			createPendingApproval(chatId, user, ctx)
			await notifyAdminForApproval(user, env, bot)
			await gramCtx.reply('⏳ Your access request has been sent to the admin for approval.\n\nYou will be notified once approved.')
			return
		}
		
		if (approval.status === 'pending') {
			await gramCtx.reply('⏳ Your request is still pending admin approval. Please wait.')
			return
		}
		
		if (approval.status === 'rejected') {
			await gramCtx.reply('❌ Your access request was denied. Contact the administrator for more information.')
			return
		}
		
		// Approved user
		await gramCtx.reply(
			'✅ *Welcome!*\n\n' +
			'You have access to the flight tracking bot.\n\n' +
			'Use /help to see available commands.',
			{ parse_mode: 'Markdown' }
		)
	})
	
	// ... rest of existing commands (track, status, clear_tracked, test)
	
	// NEW: Admin approval callback handlers
	bot.callbackQuery(/^approve_(\d+)$/, async (gramCtx) => {
		const adminId = gramCtx.from?.id
		
		if (!isAdminUser(adminId, env)) {
			await gramCtx.answerCallbackQuery('❌ Admin only action')
			return
		}
		
		const chatId = parseInt(gramCtx.match[1])
		approveUser(chatId, adminId!, ctx)
		
		// Notify user
		try {
			await bot.api.sendMessage(
				chatId,
				'✅ *Your access has been approved!*\n\n' +
				'You can now use all bot commands. Send /help to get started.',
				{ parse_mode: 'Markdown' }
			)
		} catch (error) {
			console.error(`Failed to notify approved user ${chatId}:`, error)
		}
		
		await gramCtx.answerCallbackQuery('✅ User approved')
		
		// Update admin message
		const originalText = gramCtx.callbackQuery.message?.text || ''
		await gramCtx.editMessageText(
			originalText + '\n\n✅ *APPROVED*',
			{ parse_mode: 'Markdown' }
		)
	})
	
	bot.callbackQuery(/^reject_(\d+)$/, async (gramCtx) => {
		const adminId = gramCtx.from?.id
		
		if (!isAdminUser(adminId, env)) {
			await gramCtx.answerCallbackQuery('❌ Admin only action')
			return
		}
		
		const chatId = parseInt(gramCtx.match[1])
		rejectUser(chatId, adminId!, ctx)
		
		// Notify user
		try {
			await bot.api.sendMessage(
				chatId,
				'❌ *Your access request was denied.*\n\n' +
				'If you believe this is an error, please contact the administrator.',
				{ parse_mode: 'Markdown' }
			)
		} catch (error) {
			console.error(`Failed to notify rejected user ${chatId}:`, error)
		}
		
		await gramCtx.answerCallbackQuery('❌ User rejected')
		
		// Update admin message
		const originalText = gramCtx.callbackQuery.message?.text || ''
		await gramCtx.editMessageText(
			originalText + '\n\n❌ *REJECTED*',
			{ parse_mode: 'Markdown' }
		)
	})
	
	// ... rest of existing callback queries
}
```

Add imports at top of file:
```typescript
import { createApprovalMiddleware } from '../middleware/approval'
import { getUserApproval, createPendingApproval, approveUser, rejectUser } from '../services/userApprovals'
import { notifyAdminForApproval } from '../services/adminNotifications'
```

---

## Acceptance Criteria

### ✅ Code Compiles
```bash
cd workers
npx tsc --noEmit
```

### ✅ Build Succeeds
```bash
cd workers
npm run build
```

### ✅ New Files Created
```bash
ls workers/src/services/userApprovals.ts
ls workers/src/services/adminNotifications.ts
ls workers/src/middleware/approval.ts
```

### ✅ Schema Includes Approvals Table
```bash
grep -A 10 "user_approvals" workers/src/schema.ts
```

---

## Testing

Full end-to-end testing happens in Phase 5.

For now, verify code compiles and builds without errors.

---

## Rollback

```bash
git checkout workers/src/schema.ts
git checkout workers/src/handlers/commands.ts
rm workers/src/services/userApprovals.ts
rm workers/src/services/adminNotifications.ts
rm workers/src/middleware/approval.ts
```

---

## Next Phase

Once all acceptance criteria pass, proceed to **Phase 5: Testing & Deployment**.
