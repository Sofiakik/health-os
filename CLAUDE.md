# Health OS — Claude Instructions

## Read these first, every session:
1. `agents/context.md` — full project description, architecture, core tables, system rules
2. `agents/claude-rules.md` — how Claude should behave on this project

## Quick summary (details in files above)

**What this is:** Personal health analytics combining WHOOP data, meals, and AI insights.

**Stack:** Next.js (App Router) · TypeScript · Supabase · Vercel

**Core data flow:**
Ingestion → Aggregation (`upsert_daily_health_summary_entries`) → Insights (`generateDailyInsights`) → UI

**Non-negotiables:**
- Always use `event_time`, never `created_at`
- Never change DB schema unless explicitly told
- Never bypass the aggregation layer
- Minimize changes — keep behaviour identical unless told otherwise

## Project structure
```
app/          # Next.js pages and API routes
components/   # UI components
lib/          # Core logic and helpers
agents/       # Claude instructions and project context
docs/         # Product notes, roadmap, decisions
supabase/     # DB schema and migrations
```

## Before starting any task
1. Read `agents/context.md` and `agents/claude-rules.md`
2. Check `docs/product/roadmap.md` for current priorities
3. Ask clarifying questions before making changes
