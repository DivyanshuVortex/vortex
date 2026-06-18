# Vortex - Codebase Documentation

## Overview

Vortex is an AI-powered developer assistant that provides contextual code reviews, issue analysis, and repository insights through semantic code search and LLM integration.

## Architecture

### Monorepo Structure

- **packages/cli** - Entry point with command handlers
- **packages/engine** - Core AI logic (Indexer, IntelligenceAgent)
- **packages/db** - SQLite database layer with Prisma
- **packages/retrieval** - Vector embeddings and semantic search
- **packages/github** - GitHub API integration
- **packages/git** - Git utilities
- **packages/shared** - Shared types and utilities
- **packages/ui** - React components (placeholder)
- **services/worker** - BullMQ background job processor

### Key Data Structures

**Chunk** (retrieved from DB or generated)
```typescript
{
  id: string
  file: string
  content: string
  symbolPath: string
  kind: "function" | "class" | "method" | "interface" | "type" | "enum"
  isExported: boolean
  isAsync: boolean
  dependencies: string[]
  startLine: number
  endLine: number
  language: string
  embedding?: number[]
  hash: string
}
```

### Processing Pipeline

1. **Repository Indexing** (`Indexer.indexRepository`)
   - Scan git-tracked files (*.ts, *.tsx, *.js, *.jsx)
   - Parse with TypeScript AST → Extract functions/classes/types
   - Generate embeddings for each symbol
   - Store in SQLite with embeddings

2. **Semantic Search** (`Indexer.search`)
   - Generate embedding for query
   - Perform cosine similarity search on stored embeddings
   - Return top-k chunks sorted by relevance

3. **PR Review** (`IntelligenceAgent.generateRAGReview`)
   - Extract search queries from diff
   - Retrieve relevant code chunks
   - Generate review with LLM context

4. **Issue Analysis** (`IntelligenceAgent.generateIssueAnalysis`)
   - Parse issue title and body
   - Search for relevant code
   - Generate diagnosis and solutions

## Key Classes

### Indexer
- Manages code indexing and vector storage
- Methods:
  - `indexRepository(cwd)` - Index all tracked files
  - `search(query, limit)` - Semantic search

### IntelligenceAgent
- Wraps Gemini API with retry logic
- Methods:
  - `generateReview(diff)` - Basic code review
  - `generateRAGReview(diff, chunks)` - Context-aware review
  - `generateIssueAnalysis(...)` - Issue analysis
  - `generateSuggestions(code)` - Code suggestions
  - `autoFix(code)` - Automatic fixes
  - `answerQueryWithContext(query, chunks)` - Contextual answers

### VectorStore
- SQLite-based vector storage
- Methods:
  - `upsert(chunks, embeddings)` - Store code chunks with embeddings
  - `search(queryEmbedding, limit)` - Cosine similarity search

### LocalEmbedder
- Uses Xenova transformers for local embeddings
- Model: `Xenova/all-MiniLM-L6-v2` (22MB, cached locally)

## Data Flow

### Command: `vortex review --pr 42`
1. CLI → GithubClient.fetchPullRequestDiff
2. IntelligenceAgent.extractSearchQueriesFromDiff (3 queries)
3. Indexer.search(query) × 3 → Collect chunks
4. IntelligenceAgent.generateRAGReview(diff, chunks)
5. Format and display review

### Command: `vortex search -q "authentication"`
1. CLI → Indexer.search("authentication", limit=5)
2. LocalEmbedder.embedChunks([query_chunk])
3. VectorStore.search(embedding, limit=5)
4. IntelligenceAgent.answerQueryWithContext(query, chunks)
5. Format and display answer

## Environment Variables

```
GEMINI_API_KEY=      # Google AI API key (required)
GITHUB_TOKEN=        # GitHub token (optional, for authenticated requests)
GITHUB_OWNER=        # Repository owner
GITHUB_REPO=         # Repository name
REDIS_URL=           # Redis URL for worker (optional)
DATABASE_URL=        # SQLite database path
```

## Development Guidelines

### Adding a New Command

1. Create `packages/cli/src/commands/your-command.ts`
2. Export function `export async function yourCommand(options: any)`
3. Import in `packages/cli/src/index.ts`
4. Register in program: `program.command("your-command").action(yourCommand)`

### Adding a New IntelligenceAgent Method

1. Add method to `packages/engine/src/intelligence.ts`
2. Use `this.generateWithRetry(prompt)` for LLM calls
3. Handle retries for 503/429 errors automatically
4. Export from `packages/engine/src/index.ts`

### Adding Database Models

1. Update `packages/db/prisma/schema.prisma`
2. Run `prisma migrate dev --name model_name`
3. Export from `packages/db/src/index.ts`

## Testing

- Run `pnpm check-types` to verify TypeScript
- Run `pnpm lint` to check code style
- Manual testing: `pnpm --filter vortex-ai-cli dev <command>`

## Performance Considerations

1. **Embeddings**: First run downloads 22MB model, then cached locally
2. **Vector Search**: In-memory cosine similarity (acceptable for local repos)
3. **LLM Calls**: Timeout 120s per request, retry with exponential backoff
4. **File Indexing**: Processes TypeScript/JavaScript only, filters node_modules

## Known Limitations

1. AST parsing only for TypeScript/JavaScript
2. No support for multi-file refactoring suggestions
3. Vector search runs in-memory (not scalable for 100k+ chunks)
4. No persistent session/memory between commands

## Future Improvements

- [ ] Add more language support (Python, Go, Rust)
- [ ] Implement Redis-backed vector store for scale
- [ ] Add webhook integration for automatic PR reviews
- [ ] Support for multiple LLM providers
- [ ] VS Code extension
- [ ] Web dashboard
