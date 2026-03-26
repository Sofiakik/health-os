PROJECT: Health OS

DESCRIPTION:
Personal health analytics system combining wearable data (WHOOP), manual inputs (meals, notes), and AI-generated insights.

---

CORE ARCHITECTURE:

Data flows in this order:

1. Ingestion
   - WHOOP → health_metrics (via /api/whoop/sync)
   - Meals → entries (via process-meal / process-meals-batch)

2. Aggregation
   - Function: upsert_daily_health_summary_entries
   - Combines:
     - WHOOP data
     - Meal macros (calories, protein, carbs, fat)
   - Output table: daily_health_summary

3. Insights
   - Function: generateDailyInsights
   - Input:
     - daily_health_summary
     - personal_patterns
   - Output table: daily_insights

4. UI
   - calendar/page.tsx displays:
     - daily_health_summary
     - daily_insights

---

CORE TABLES:

entries
- event_time (canonical time — ALWAYS use this)
- calories_kcal, protein_g, carbs_g, fat_g
- nutrition_extracted_at

daily_health_summary
- one row per user per day
- aggregated metrics

daily_insights
- insight_text
- hypothesis
- confidence

personal_patterns
- discovered correlations

---

STRICT SYSTEM RULES:

- ALWAYS use event_time (NEVER created_at)
- NEVER change DB schema unless explicitly told
- aggregation MUST go through:
  upsert_daily_health_summary_entries
- insights MUST go through:
  generateDailyInsights
- NEVER bypass aggregation layer
- NEVER write directly to daily_health_summary from API routes

---

CODING PATTERNS:

- API routes live in: app/api/
- Core logic lives in: lib/
- DB access via Supabase client (server/admin where appropriate)
- Prefer reusing existing helpers over creating new ones

---

WHEN MODIFYING CODE:

- Keep behavior identical unless explicitly told
- Minimize changes
- Do not introduce new architecture patterns
- Do not rename existing fields or endpoints

---

GOAL:

Maintain a stable pipeline:

ingestion → aggregation → insights → UI

Do NOT break this flow.
