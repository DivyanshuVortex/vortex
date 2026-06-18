# Vortex - Developer Intelligence & PR Review Engine

**Vortex** is an AI-powered developer assistant that combines semantic code search, Git integration, and LLM-based intelligence to provide contextual code reviews, issue analysis, and repository insights.

## Project Structure

```
vortex/
├── packages/
│   ├── cli/              # Command-line interface
│   ├── engine/           # Core AI logic (Indexer, IntelligenceAgent)
│   ├── db/               # Database layer with Prisma SQLite
│   ├── retrieval/        # Vector embeddings & semantic search
│   ├── github/           # GitHub API client and utilities
│   ├── git/              # Git utilities and repository operations
│   ├── shared/           # Shared types and utilities
│   ├── ui/               # React components (for future web UI)
│   ├── eslint-config/    # Shared ESLint configuration
│   └── typescript-config/# Shared TypeScript configuration
├── services/
│   └── worker/           # BullMQ worker for async jobs
├── apps/                 # Reserved for future applications
└── config/               # Configuration files
```

## Key Components

### CLI (`packages/cli`)
The main entry point with commands:
- `init` - Initialize repository indexing and embeddings
- `search` - Semantic codebase search with AI explanations
- `review` - AI-powered PR review with RAG (Retrieval-Augmented Generation)
- `issue` - Analyze GitHub issues and propose solutions
- `suggest` - Generate code suggestions for files
- `fix-nitbits` - Automatically fix formatting and minor issues
- `analyze` - Analyze external PRs
- `watch` - Live monitoring for code changes

### Engine (`packages/engine`)
Core AI components with **IntelligenceAgent** class:
- `generateReview(diff)` - Generate code review from diff
- `generateRAGReview(diff, chunks)` - Context-aware review with codebase context
- `generateIssueAnalysis(...)` - Issue analysis and solutions
- `generateSuggestions(code)` - Code improvement suggestions
- `autoFix(code)` - Automated code fixes
- `answerQueryWithContext(query, chunks)` - Contextual Q&A

### Retrieval (`packages/retrieval`)
- **LocalEmbedder**: Xenova transformers for local embeddings
- **VectorStore**: SQLite-based vector storage with Prisma
- **chunkFile**: TypeScript AST-based code chunking
- **scanner**: File system scanner with gitignore support

### Database (`packages/db`)
SQLite database with Prisma ORM - `Chunk` model for storing code embeddings

## Setup Instructions

### Prerequisites
- Node.js >= 18
- pnpm 9.1.0
- GEMINI_API_KEY (from Google AI)
- GITHUB_TOKEN (optional)

### Installation

```bash
git clone <repo-url>
cd vortex
pnpm install
pnpm build
cp .env.example .env  # Configure with your API keys
```

### Environment Variables

```bash
# Required
GEMINI_API_KEY=your_google_gemini_key

# Optional
GITHUB_TOKEN=your_github_token
GITHUB_OWNER=your_username
GITHUB_REPO=your_repo_name
```

## Usage

```bash
# Initialize repository
vortex init

# Search codebase
vortex search -q "authentication handler" -l 10

# Review PR
vortex review --pr 42 --deep

# Analyze issue
vortex issue --id 123

# Get suggestions
vortex suggest --file src/api.ts

# Auto-fix code
vortex fix-nitbits --files src/utils.ts --dry-run

# Watch for changes
vortex watch --deep
```

## Development

```bash
# Watch mode
pnpm dev

# Type checking
pnpm check-types

# Linting
pnpm lint

# Format code
pnpm format
```

## Architecture

### Data Flow
1. **Indexing**: Files → AST chunks → Embeddings → SQLite
2. **Search**: Query → Embedding → Vector search → RAG context
3. **Review**: PR diff → Query extraction → Context retrieval → LLM review

### Technology Stack
- **Language**: TypeScript
- **Build**: Turbo + tsup
- **Package Manager**: pnpm
- **Database**: SQLite + Prisma
- **AI Model**: Google Gemini 2.5 Flash
- **Embeddings**: Xenova transformers
- **Job Queue**: BullMQ

## Troubleshooting

### Database Issues
```bash
rm .vortex.db
pnpm --filter vortex-ai-cli dev init
```

### Embeddings Not Working
- First run downloads model to `~/.cache/huggingface`
- Check internet connection
- Verify `@xenova/transformers` is installed

## License

MIT
