# src/core/ — Cross-Process Business Logic

Shared domain layer imported by both `src/main/` and scripts. No Electron APIs here — only Node.js + AI SDK.

## STRUCTURE

```
core/
├── ai-client.ts                 # AIClient — unified LLM call wrapper (chat + vision)
├── model-provider.ts            # Model provider multi-profile management
├── session-types.ts             # Session event types
├── token-usage.ts               # Token usage tracking
├── error-utils.ts               # Shared error helpers (isRecord, getErrorMessage)
├── vision-self-check.ts         # Vision self-check for action chain
├── AGENTS.md                    # ← 本文件
├── rpa/                         # RPA utilities (see own AGENTS.md)
├── action-chain/                # Action chain engine + types + templates
├── agent-assistant/             # AI agent assistant (orchestrator, proposal, prompt)
├── chat-history/                # Chat history extraction, storage, context injection
└── work-memory/                 # Experience cards + session store
```

## WHERE TO LOOK

| Task                          | Location                                                    | Notes                                              |
| ----------------------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| Change LLM call logic         | `ai-client.ts`                                              | Supports chat + vision APIs                        |
| Modify model provider         | `model-provider.ts`                                         | Multi-profile management                           |
| Change action chain engine    | `action-chain/engine.ts`                                    | Step execution loop                                |
| Modify AI assistant           | `agent-assistant/orchestrator.ts`                           | Manager + specialist orchestration                 |
| Change chat history           | `chat-history/parser.ts`                                    | VLM prompts for chat extraction                    |
| Modify experience cards       | `work-memory/experience-store.ts`                           | JSON file store                                    |
| Change token usage tracking   | `token-usage.ts`                                            | Parse API response usage fields                    |

## CONVENTIONS

- All files here are pure TypeScript, no Electron imports
- `isRecord()` from `error-utils.ts` is the canonical type guard — use it, don't redefine
- `LayoutCache` (from `rpa/vision-utils.ts`) is the shared data structure for VLM layout detection
- Experience cards use `MemoryCardBrief` (subset) for injection, full `ExperienceCard` for storage

## NOTES

- `consecutiveUnreadFailures` counter has been removed; retry logic now handled by the action chain engine
- Chat history is currently limited to certain IM apps (guarded by `appType` check)
- `work-memory/` was previously named `memory/` and `trace/` — both have been consolidated
