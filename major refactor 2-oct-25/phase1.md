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
```json
{
  "dependencies": {
    "grammy": "^1.30.0",
    "ofetch": "^1.4.1",
    "prettier": "^3.6.2",
    "typegram": "^5.2.0"
  }
}
```

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

### 4. Update package.json scripts (optional)

**File**: `workers/package.json`

Add convenient dev/deploy scripts:
```json
{
  "scripts": {
    "deploy": "wrangler deploy",
    "deploy:dev": "wrangler deploy --env dev",
    "build": "esbuild src/index.ts --bundle --outfile=dist/worker.js --format=esm --target=es2022 --external:cloudflare:workers",
    "dev": "wrangler dev --env dev",
    "start": "wrangler dev",
    "test": "vitest",
    "cf-typegen": "wrangler types"
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

## Testing

### Test Default Deployment (Production)
```bash
cd workers
wrangler deploy
```
Should deploy to `flights` worker (production).

### Test Dev Deployment
```bash
cd workers
wrangler deploy --env dev
```
Should deploy to `flights-dev` worker.

**Note**: At this stage, functionality is unchanged - just verifying build & deploy work.

---

## Rollback

If something breaks:

### Revert wrangler.toml
```bash
git checkout workers/wrangler.toml
```

### Uninstall Grammy
```bash
cd workers
npm uninstall grammy
```

### Revert env.ts
```bash
git checkout workers/src/env.ts
```

---

## Common Issues

### Issue: "wrangler deploy --env dev" fails
**Solution**: Verify `[env.dev]` section syntax is correct in wrangler.toml.

### Issue: TypeScript errors after updating env.ts
**Solution**: The new fields (WEBHOOK_SECRET, ADMIN_CHAT_IDS) won't be used until later phases. This is expected.

### Issue: Grammy import errors
**Solution**: 
```bash
cd workers
rm -rf node_modules
npm install
```

---

## Next Phase

Once all acceptance criteria pass, proceed to **Phase 2: Security Infrastructure**.
