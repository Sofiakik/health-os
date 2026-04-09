/**
 * Tests for the nutrition extraction pipeline fix.
 *
 * Two suites:
 *   1. Unit  — JSON parsing logic (no network calls)
 *   2. Integration — full processMealEntry against real DB + OpenAI
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/test-nutrition-pipeline.ts
 *
 * For integration tests only, set USER_ID:
 *   USER_ID=<uuid> npx tsx --env-file=.env.local scripts/test-nutrition-pipeline.ts
 */

import { supabaseAdmin } from "../lib/supabaseAdmin";
import { processMealEntry } from "../lib/mealNutrition";

// ---------------------------------------------------------------------------
// Tiny assertion helper
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: unknown) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`, detail ?? "");
    failed++;
  }
}

// ---------------------------------------------------------------------------
// SUITE 1: JSON parsing logic (unit — no network)
// ---------------------------------------------------------------------------
function parseOutputText(outputText: string): object | null {
  const jsonMatch = outputText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

function runJsonParsingTests() {
  console.log("\n── Suite 1: JSON parsing ──────────────────────────────────────");

  const clean = `{"calories_kcal":500,"protein_g":30,"carbs_g":60,"fat_g":15,"confidence":0.9,"notes":"test"}`;
  const r1 = parseOutputText(clean) as any;
  assert(r1 !== null, "parses clean JSON");
  assert(r1?.calories_kcal === 500, "extracts calories_kcal from clean JSON");

  const fenced = "```json\n" + clean + "\n```";
  const r2 = parseOutputText(fenced) as any;
  assert(r2 !== null, "parses backtick-fenced JSON");
  assert(r2?.calories_kcal === 500, "extracts calories_kcal from fenced JSON");

  const withPreamble = "Here is the nutritional breakdown:\n" + clean + "\nLet me know if you need more.";
  const r3 = parseOutputText(withPreamble) as any;
  assert(r3 !== null, "parses JSON with surrounding text");
  assert(r3?.calories_kcal === 500, "extracts calories_kcal from surrounded JSON");

  const empty = "I cannot determine nutrition from this input.";
  const r4 = parseOutputText(empty);
  assert(r4 === null, "returns null when no JSON object present");

  const nullValues = `{"calories_kcal":null,"protein_g":null,"carbs_g":null,"fat_g":null,"confidence":0.3,"notes":"unclear"}`;
  const r5 = parseOutputText(nullValues) as any;
  assert(r5 !== null, "parses JSON with null macro values");
  assert(r5?.calories_kcal === null, "null calories_kcal is preserved");
}

// ---------------------------------------------------------------------------
// SUITE 2: Integration — real DB + real OpenAI call
// ---------------------------------------------------------------------------
async function runIntegrationTests(userId: string) {
  console.log("\n── Suite 2: Integration (processMealEntry) ────────────────────");
  console.log(`   user_id: ${userId}\n`);

  // ── 2a: Insert a test entry ──────────────────────────────────────────────
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("entries")
    .insert({
      user_id: userId,
      note: "2 scrambled eggs with toast and orange juice",
      note_type: "meal",
      event_time: new Date().toISOString(),
      nutrition_extracted_at: null,
    })
    .select("id")
    .single();

  assert(!insertError, "test entry inserted without error", insertError);
  if (!inserted) {
    console.error("  Aborting integration tests: could not insert test entry");
    return;
  }

  const entryId = inserted.id;
  console.log(`   inserted entry id: ${entryId}`);

  // ── 2b: Run processMealEntry ─────────────────────────────────────────────
  let result: Awaited<ReturnType<typeof processMealEntry>>;
  try {
    result = await processMealEntry({ entry_id: entryId, user_id: userId });
  } catch (e) {
    assert(false, "processMealEntry did not throw", e);
    await cleanup(entryId);
    return;
  }

  assert(!result.skipped, "processMealEntry returned skipped=false", result);

  // ── 2c: Verify DB was updated ────────────────────────────────────────────
  const { data: updated, error: fetchError } = await supabaseAdmin
    .from("entries")
    .select("calories_kcal, protein_g, carbs_g, fat_g, nutrition_extracted_at")
    .eq("id", entryId)
    .single();

  assert(!fetchError, "re-fetched entry without error", fetchError);
  assert(updated?.nutrition_extracted_at !== null, "nutrition_extracted_at is set");
  assert(updated?.calories_kcal !== null, "calories_kcal is non-null");
  assert(updated?.protein_g !== null, "protein_g is non-null");
  assert(typeof updated?.calories_kcal === "number", "calories_kcal is a number", updated?.calories_kcal);
  assert(typeof updated?.protein_g === "number", "protein_g is a number", updated?.protein_g);

  console.log(`\n   Written values: calories=${updated?.calories_kcal} protein=${updated?.protein_g} carbs=${updated?.carbs_g} fat=${updated?.fat_g}`);

  // ── 2d: Idempotency — re-running on high-confidence entry should skip ─────
  const result2 = await processMealEntry({ entry_id: entryId, user_id: userId });
  assert(result2.skipped, "second run is skipped (idempotency)");

  // ── 2e: Unknown entry returns skipped, not a throw ───────────────────────
  const fakeId = "00000000-0000-0000-0000-000000000000";
  const result3 = await processMealEntry({ entry_id: fakeId, user_id: userId });
  assert(result3.skipped && result3.reason === "not_found_or_not_owned", "unknown entry_id returns skipped=not_found_or_not_owned");

  await cleanup(entryId);
}

async function cleanup(entryId: string) {
  await supabaseAdmin.from("entries").delete().eq("id", entryId);
  console.log(`\n   cleaned up entry ${entryId}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== nutrition pipeline tests ===");

  runJsonParsingTests();

  const userId = process.env.USER_ID ?? process.env.TEST_USER_ID;
  if (!userId) {
    console.log("\n── Suite 2 skipped (set USER_ID env var to run integration tests) ──");
  } else {
    await runIntegrationTests(userId);
  }

  console.log(`\n${"─".repeat(55)}`);
  console.log(`  ${passed} passed  |  ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
