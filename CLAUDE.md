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

## Deployment Flow

1. Push to GitHub (from any environment)
2. Cloudflare auto-deploys
3. GitHub Action detects successful deployment
4. GitHub Action creates a Release with tag (e.g., `v1.0.107`)
5. GitHub Action calls `/deploy-webhook` endpoint with version + release URL
6. Worker saves version to KV and sends Telegram notification with release link

## KV Storage

- **METADATA** namespace stores deployment metadata:
  - `version` - Current deployed version
  - `last_deploy_date` - Date of last deployment
