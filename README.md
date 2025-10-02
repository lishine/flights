# Flights

A flight information and suggestions application with multiple deployment targets.

## Project Structure

- `/workers` - Cloudflare Worker source code for the main API
- `/vercel` - Vercel deployment configuration and functions
- `/.github/workflows` - GitHub Actions for automated deployment and releases

## Deployment

### Production

- **Cloudflare Workers**: `https://flights.vim55k.workers.dev`
- Automatic deployment on push to main branch

### Features

- Automatic version management via GitHub Actions
- Version format: `1.0.{commit_count}`
- Deployment notifications via Telegram webhook
- Cloudflare KV storage for metadata

## Development

This project uses pnpm as the package manager. To get started:

```bash
# Install dependencies
pnpm install

# Install dependencies for workers
cd workers && pnpm install

# Install dependencies for vercel
cd vercel && pnpm install
```
