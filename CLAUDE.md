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

## Development Workflow

**User Preference: Direct Commit & Push**
- Work directly on main branch when possible
- Skip pull request workflow for straightforward changes
- Commit with descriptive messages using conventional commit format
- Push directly to main to trigger automatic deployment
- Use feature branches only when explicitly required or for complex features

**Quality Requirements:**
- Always run code quality checks (prettier, build, tests)
- Ensure clean working directory before committing
- Include comprehensive commit messages
- Validate deployment success after push
