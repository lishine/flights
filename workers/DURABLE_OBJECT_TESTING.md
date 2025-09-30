# Durable Object Testing Guide

## Overview

The FlightDO durable object has been set up with alarm functionality that triggers every 1 minute. Here's how to test it:

## Implementation Details

- **Storage Backend**: SQLite-backed (recommended by Cloudflare, replaces obsolete KV backend)
- **Migration**: Configured with `new_sqlite_classes = ["FlightDO"]` in wrangler.toml
- **Initialization**: Uses `blockConcurrencyWhile()` for proper initialization
- **API Used**: Official Cloudflare Durable Objects SQLite Storage API
- **Features**:
    - Alarms API (`getAlarm()`, `setAlarm()`) - Async operations
    - **Synchronous KV Storage API** (`ctx.storage.kv.get()`, `ctx.storage.kv.put()`, `ctx.storage.kv.delete()`) - Sync operations for simple ops
    - Async Storage API (`ctx.storage.get()`, `ctx.storage.put()`) - For alarm handlers and complex operations
    - SQL API (`ctx.storage.sql.exec()`) - stored in hidden `__cf_kv` table
    - Point-in-Time Recovery (PITR) support
- **Reference**: https://developers.cloudflare.com/durable-objects/api/storage-api/

## Manual Testing

### 1. Deploy the Worker

First, deploy your worker with the updated durable object:

```bash
cd workers
npm run deploy
```

### 2. Test Endpoints

Once deployed, you can test the durable object using these endpoints:

#### Status Check

```
GET https://flights.vim55k.workers.dev/do/test/status
```

Response: `FlightDO Status - Alarms fired: X`

#### Reset Alarm Counter

```
GET https://flights.vim55k.workers.dev/do/test/reset
```

Response: `Alarm count reset and new alarm set`

#### General Status

```
GET https://flights.vim55k.workers.dev/do/test
```

Response:

```
FlightDO Active
Alarms fired: X
Next alarm: 2025-XX-XXTXX:XX:XX.XXXZ
```

### 3. Testing Alarm Functionality

1. **Check initial status** - Note the alarm count (should be 0 initially)
2. **Wait for 1 minute** - The alarm should fire automatically
3. **Check status again** - The alarm count should increment by 1
4. **Check logs** - You should see console logs like:
    ```
    Setting alarm for 60000ms from now
    Alarm fired! Count: 1
    Setting next alarm for 60000ms from now
    ```

### 4. Using Different Durable Object Instances

You can create different durable object instances by using different names:

```
GET https://flights.vim55k.workers.dev/do/instance1/status
GET https://flights.vim55k.workers.dev/do/instance2/status
GET https://flights.vim55k.workers.dev/do/flight-tracker/status
```

Each instance maintains its own alarm counter and state.

## Automated Testing

Run the test suite:

```bash
cd workers
npm test
```

This will run the `durable-object.test.ts` file which includes:

- Unit tests for alarm timing logic
- Mock tests for durable object endpoints
- Alarm counter functionality tests

## Troubleshooting

### Common Issues

1. **Alarm not firing**: Check that the durable object class name in `wrangler.toml` matches exactly with the class name in `durable.ts`

2. **TypeScript errors**: Make sure the `Env` interface in `env.ts` properly types the durable object methods

3. **Wrong binding name**: Ensure `index.ts` uses `FLIGHTS_DO` (not `MY_DURABLE_OBJECT`)

### Logs and Debugging

- Check Cloudflare Dashboard logs for alarm execution
- Use `console.log` statements in the alarm handler for debugging
- Monitor the alarm counter to verify alarms are firing

## Expected Behavior

- Alarm sets itself 1 minute after durable object initialization
- Each alarm increments a counter stored in durable storage
- Next alarm is automatically scheduled after each firing
- Counter persists across deployments and worker restarts
- Each named instance (e.g., `/do/test`, `/do/instance1`) is independent
