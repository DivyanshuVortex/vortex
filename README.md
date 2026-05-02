# Vortex

Vortex is a monorepo optimized for binary-first deployment with an optional UI and background worker.

## Structure

```
vortex/
  apps/
    ui/                      # Optional web interface (Next.js)

  packages/
    cli/                     # 🚀 FINAL DEPLOYABLE BINARY
    engine/                  # Core business logic
    git/                     # Git parsing and utilities
    retrieval/               # Vector search and embeddings
    db/                      # SQLite database adapter
    github/                  # GitHub API integration
    shared/                  # Common utilities
    ui-components/           # Shared React components

  services/
    worker/                  # Background jobs (BullMQ)

  config/
    tsconfig.base.json       # Base TypeScript configuration
    turbo.json               # Turborepo configuration
```

## Getting Started

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Run development mode:
   ```bash
   pnpm dev
   ```

3. Build all packages:
   ```bash
   pnpm build
   ```

## CLI Usage

The CLI is located in `packages/cli`. You can run it locally during development:

```bash
cd packages/cli
pnpm dev
```

Or build it to get the final binary.
