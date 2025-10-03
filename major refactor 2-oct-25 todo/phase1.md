# Phase 1: Environment Setup

**Estimated Time**: 30 minutes  
**Goal**: Prepare dev/prod separation and install dependencies

---

## Changes in This Phase

### 1. Update wrangler.toml

Add development environment configuration.

**File**: `workers/wrangler.toml`

**Add after existing config**:

```toml
# Development environment
[env.dev]
name = "flights-dev"

[[env.dev.durable_objects.bindings]]
name = "FLIGHTS_DO"
class_name = "FlightDO"

[[env.dev.migrations]]
tag = "v1"
new_sqlite_classes = ["FlightDO"]
```

### 2. Install Dependencies

**File**: `workers/package.json`

Add to dependencies:

Run:

```bash
cd workers
npm install grammy
```

Or if using pnpm:

```bash
cd workers
pnpm add grammy
```

### 3. Update env.ts

**File**: `workers/src/env.ts`

Replace with:

```typescript
export interface Env {
	BOT_TOKEN: string
	WEBHOOK_SECRET: string
	ADMIN_CHAT_IDS: string
	FLIGHTS_DO: {
		getByName(name: string): {
			fetch(request: Request): Promise<Response>
			sayHello(): Promise<string>
		}
	}
}
```

---

## Acceptance Criteria

Before moving to Phase 2, verify:

### ✅ Configuration Check

```bash
cd workers
cat wrangler.toml | grep -A 5 "env.dev"
```

Should show dev environment config.

### ✅ Dependencies Installed

```bash
cd workers
npm list grammy
```

Should show grammy version installed.

### ✅ TypeScript Compiles

```bash
cd workers
npx tsc --noEmit
```

Should complete without errors.

### ✅ Build Works

```bash
cd workers
npm run build
```

Should create `dist/worker.js`.

---

# git

commit
push
