# AI Agent Instructions

## Worker Deployment

- **Production URL**: `https://flights.vim55k.workers.dev`
- Deployment happens automatically on push to main branch via Cloudflare GitHub integration

## Project Structure

- `/workers` - Cloudflare Worker source code
- `/workers/src` - TypeScript source files
- `/workers/version.json` - Version tracking (auto-updated by git post-commit hook)
- `/.github/workflows` - GitHub Actions for deployment notifications

## Version Management

The project uses automatic version management:
- Git post-commit hook updates `workers/version.json`
- Version format: `{major}.{minor}.{commit_count}`
- Committed with `--amend` to include in the same commit

## Deployment Flow

1. Commit changes (version.json auto-updates via post-commit hook)
2. Push to GitHub
3. Cloudflare auto-deploys
4. GitHub Action detects successful deployment
5. Calls `/deploy-webhook` endpoint
6. Worker sends Telegram notification with version number
