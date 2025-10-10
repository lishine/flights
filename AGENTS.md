# AI Agent Instructions

## Worker Deployment

- **Production URL**: `https://flights.vim55k.workers.dev`
- Deployment happens automatically on push to main branch via Cloudflare GitHub integration

## Project Structure

- `/workers` - Cloudflare Worker source code
- `/workers/src` - TypeScript source files
- `/.github/workflows` - GitHub Actions for deployment notifications and releases

## Version Management

The project uses automatic version management via GitHub Actions:

- Version format: `1.0.{commit_count}`
- Version is calculated from total commit count on each deployment
- Stored in Cloudflare KV (`env.METADATA`)
- No local git hooks required

## KV Storage

- **METADATA** namespace stores deployment metadata:
    - `version` - Current deployed version
    - `last_deploy_date` - Date of last deployment

# Dates

for this project for current time use - getCurrentIdtTime. not Date()

# deploy

don't try wrangler deploy because it is cf integtation as per above

## Cloudflare free limitations

kv - 1000 writes per day
sqlite - 100,000 wrties per day

# Acceptance!!

cd workers && npx tsc --noEmit


## storage
for front end telegram state use inline sending data , not store it in backend db