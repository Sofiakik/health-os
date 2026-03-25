import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.2";
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pearsonCorr(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 2) return null;

  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  if (!Number.isFinite(den) || den === 0) return null;
  return num / den;
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] == null) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function extractThemes(text: string): Set<string> {
  const t = text.toLowerCase();
  const s = new Set<string>();

  if (/(late).*(meal)|meal.*(late)/.test(t)) s.add("late_meal");
  if (/(calorie|kcal|deficit|surplus)/.test(t)) s.add("calories");
  if (/(sleep)/.test(t)) s.add("sleep");
  if (/(protein|carb|carbs|fat|macro)/.test(t)) s.add("macros");
  if (/(strain|recovery|hrv)/.test(t)) s.add("recovery");

  return s;
}

function themeJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

type DailyInsightsRow = {
  insight_text: string | null;
};

async function generateInsightFromComputedSignals(
  user_id: string,
  date: string,
  computedSignals: any,
  confidence: number
) {
  // Anti-repetition: compare against last 3 saved insights (normalized columns only).
  const { data: recentRows } = await supabase
    .from("daily_insights")
    .select("insight_text")
    .eq("user_id", user_id)
    .order("date", { ascending: false })
    .limit(3) as { data: DailyInsightsRow[] | null; error?: any };

  const recentInsights = (recentRows ?? [])
    .map((r) => r.insight_text ?? "")
    .filter(Boolean);

  const recentThemes = recentInsights.map((t) => extractThemes(t));

  const previousThemesText = recentInsights.length
    ? recentInsights.map((t) => `- ${t.slice(0, 140)}`).join("\n")
    : "(none)";

  const prompt = [
    "You are a high-performance health analyst.",
    "",
    "You are given:",
    "- daily health data (sleep, recovery, strain)",
    "- nutrition (calories, macros)",
    "- behavioral signals (late meals)",
    "",
    "Computed signals (use these numbers/relationships explicitly):",
    JSON.stringify(computedSignals),
    "",
    "Your job:",
    "- find NON-OBVIOUS patterns",
    "- prioritize actionable insights",
    "- DO NOT repeat generic statements like 'sleep improves recovery'",
    "",
    "Priority order (when choosing which insights to write):",
    "1) late_meal impact",
    "2) calorie deficit / surplus proxies (low calorie vs low recovery, plus calories vs strain alignment)",
    "3) sleep (ONLY if strong signal)",
    "4) macro imbalance",
    "",
    "Rules:",
    "- Output MAX 2 insights",
    "- Each must be specific to the data",
    "- Must reference actual signals above (not generic advice)",
    "- If weak signal -> explicitly say so",
    `- Confidence must be EXACTLY: ${confidence}`,
    "",
    "- Anti-repetition rule: do not reuse the same main theme(s) from the last 3 saved insights:",
    previousThemesText,
    "",
    "Return JSON exactly with:",
    '{ "insight_text": string, "hypothesis": string, "confidence": number }',
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return JSON only. No markdown. No extra keys." },
      { role: "user", content: prompt },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content ?? "";
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    parsed = {
      insight_text:
        "Not enough structured signal to form a strong, non-repetitive insight yet.",
      hypothesis:
        "Focus on tracking consistently (entries_count) and revisit after more days accumulate.",
      confidence,
    };
  }

  let insight_text =
    typeof parsed?.insight_text === "string" ? parsed.insight_text.trim() : "";
  let hypothesis =
    typeof parsed?.hypothesis === "string" ? parsed.hypothesis.trim() : "";

  if (!insight_text) {
    insight_text =
      "Signal is weak or inconsistent; consider improving tracking quality and try again later.";
  }
  if (!hypothesis) {
    hypothesis = "With more consistent data, this pattern may become clearer.";
  }

  // Enforce anti-repetition in JS: compare the model text to last 3 themes.
  const candidateThemes = extractThemes(insight_text);
  const maxJaccard = recentThemes.reduce(
    (best, t) => Math.max(best, themeJaccard(candidateThemes, t)),
    0
  );

  if (recentInsights.length > 0 && maxJaccard >= 0.66) {
    // Rewrite once with an explicit anti-repetition directive.
    const rewritePrompt = [
      "Rewrite the insight to avoid repeating the main themes from previous insights.",
      "You MUST focus on a different signal priority than what appears in the previous insights.",
      "",
      `Previous insights (themes to avoid):\n${previousThemesText}`,
      "",
      "Computed signals are still the same; use them to form a fresh, specific, non-generic answer.",
      JSON.stringify(computedSignals),
      "",
      'Return JSON exactly: { "insight_text": string, "hypothesis": string, "confidence": number }',
    ].join("\n");

    const rewriteCompletion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return JSON only. No markdown. No extra keys." },
        { role: "user", content: rewritePrompt },
      ],
    });

    const rewriteRaw =
      rewriteCompletion.choices?.[0]?.message?.content ?? "";
    let rewriteParsed: any = null;
    try {
      rewriteParsed = JSON.parse(rewriteRaw);
    } catch (_e) {
      rewriteParsed = parsed;
    }

    const rewriteInsightText =
      typeof rewriteParsed?.insight_text === "string"
        ? rewriteParsed.insight_text.trim()
        : insight_text;
    const rewriteHypothesis =
      typeof rewriteParsed?.hypothesis === "string"
        ? rewriteParsed.hypothesis.trim()
        : hypothesis;

    const rewriteThemes = extractThemes(rewriteInsightText);
    const rewriteMaxJaccard = recentThemes.reduce(
      (best, t) => Math.max(best, themeJaccard(rewriteThemes, t)),
      0
    );

    // Still too repetitive -> skip overwriting.
    if (rewriteMaxJaccard >= 0.66) {
      console.log("[insights] skipped repetitive insight", {
        user_id,
        date,
        maxJaccard,
        rewriteMaxJaccard,
      });
      return {
        ok: true,
        result: {
          skipped: true,
          reason: "repetitive_insight",
          confidence,
        },
      };
    }

    insight_text = rewriteInsightText;
    hypothesis = rewriteHypothesis;
  }

  // Enforce confidence deterministically (JS-computed): no randomness from the model.
  const finalConfidence = confidence;

  console.log("[insights] generated", {
    user_id,
    date,
    insight_text,
    hypothesis,
    confidence: finalConfidence,
  });

  const nowIso = new Date().toISOString();
  const { error: upsertError } = await supabase
    .from("daily_insights")
    .upsert(
      {
        user_id,
        date,
        window_end_at: nowIso,
        provider: "analysis_js+llm",
        model: OPENAI_MODEL,
        insight_text,
        hypothesis,
        confidence: finalConfidence,
      },
      { onConflict: "user_id,date" }
    );

  if (upsertError) throw upsertError;

  return {
    ok: true,
    result: {
      insight_text,
      hypothesis,
      confidence: finalConfidence,
      computedSignals,
    },
  };
}

export async function generateDailyInsights(user_id: string, date: string) {
  if (!user_id) throw new Error("Missing user_id");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date format (expected YYYY-MM-DD)");
  }

  const endDate = new Date(date + "T00:00:00.000Z");
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 45);

  const windowStart = startDate.toISOString().slice(0, 10);
  const windowEnd = date;

  // Memory layer: if we've already detected signal snapshots for this date,
  // reuse them rather than recalculating correlations from daily_health_summary.
  const patternKey = `daily_insight_signals:${date}`;
  const { data: storedPattern, error: storedPatternError } = await supabase
    .from("personal_patterns")
    .select("metadata")
    .eq("user_id", user_id)
    .eq("pattern_key", patternKey)
    .maybeSingle();

  if (storedPatternError) throw storedPatternError;

  const storedComputedSignals = storedPattern?.metadata?.computedSignals;
  if (storedComputedSignals && typeof storedComputedSignals === "object") {
    const storedConfidence =
      typeof (storedComputedSignals as any).confidence === "number"
        ? (storedComputedSignals as any).confidence
        : 0;

    return generateInsightFromComputedSignals(
      user_id,
      date,
      storedComputedSignals,
      storedConfidence
    );
  }

  const { data: rows, error: rowsError } = await supabase
    .from("daily_health_summary")
    .select(
      "date,sleep_duration,recovery_score,strain,calories_kcal,protein_g,carbs_g,fat_g,late_meal,entries_count"
    )
    .eq("user_id", user_id)
    .gte("date", windowStart)
    .lte("date", windowEnd)
    .order("date", { ascending: true });

  if (rowsError) throw rowsError;

  const daily = (rows ?? []) as Array<{
    date: string;
    sleep_duration: number | null;
    recovery_score: number | null;
    strain: number | null;
    calories_kcal: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    late_meal: boolean | null;
    entries_count: number | null;
  }>;

  const windowDays = Math.max(1, daily.length); // dense dataset; avoids assuming missing days in DB.

  const sleepRecoveryPairs = daily
    .filter((r) => r.sleep_duration != null && r.recovery_score != null)
    .map((r) => [r.sleep_duration as number, r.recovery_score as number] as [number, number]);

  const lateMealRecovery = daily.filter(
    (r) => r.late_meal != null && r.recovery_score != null
  );

  const lateTrue = lateMealRecovery.filter((r) => r.late_meal === true);
  const lateFalse = lateMealRecovery.filter((r) => r.late_meal === false);

  const sleep_recovery_corr = pearsonCorr(sleepRecoveryPairs);
  const sleep_recovery_corr_n = sleepRecoveryPairs.length;

  const late_avg_true =
    lateTrue.length > 0 ? lateTrue.reduce((a, r) => a + (r.recovery_score as number), 0) / lateTrue.length : null;
  const late_avg_false =
    lateFalse.length > 0 ? lateFalse.reduce((a, r) => a + (r.recovery_score as number), 0) / lateFalse.length : null;

  const late_meal_recovery_diff =
    late_avg_true != null && late_avg_false != null ? late_avg_true - late_avg_false : null;

  // "late_meal_penalty" is positive when late meals are associated with worse recovery.
  const late_meal_penalty =
    late_meal_recovery_diff != null ? Math.max(0, (late_meal_recovery_diff as number) * -1) : 0;

  const caloriesStrainPairs = daily
    .filter((r) => r.calories_kcal != null && r.strain != null)
    .map((r) => [r.calories_kcal as number, r.strain as number] as [number, number]);

  const calories_vs_strain_corr = pearsonCorr(caloriesStrainPairs);
  const calories_vs_strain_corr_n = caloriesStrainPairs.length;

  const caloriesVals = daily.map((r) => r.calories_kcal).filter((x): x is number => x != null);
  const recoveryVals = daily.map((r) => r.recovery_score).filter((x): x is number => x != null);

  const avg_calories =
    caloriesVals.length > 0 ? caloriesVals.reduce((a, b) => a + b, 0) / caloriesVals.length : 0;

  const lowCalThreshold = quantile(caloriesVals, 0.33);
  const lowRecoveryThreshold = quantile(recoveryVals, 0.33);

  const lowCalDays =
    lowCalThreshold == null
      ? []
      : daily.filter((r) => r.calories_kcal != null && r.calories_kcal <= lowCalThreshold);

  const low_calorie_days_count = lowCalDays.length;

  const lowCalRecovery =
    lowRecoveryThreshold == null
      ? null
      : lowCalDays.filter((r) => r.recovery_score != null && (r.recovery_score as number) <= lowRecoveryThreshold);

  const low_calorie_low_recovery_rate =
    lowRecoveryThreshold != null && lowCalDays.length > 0
      ? lowCalRecovery?.length != null
        ? lowCalRecovery.length / lowCalDays.length
        : null
      : null;

  const nonLowCalDays = lowCalThreshold == null ? [] : daily.filter((r) => r.calories_kcal != null && r.calories_kcal > lowCalThreshold);

  const nonLowCalLowRecoveryRate =
    lowRecoveryThreshold != null && nonLowCalDays.length > 0
      ? nonLowCalDays.filter((r) => r.recovery_score != null && (r.recovery_score as number) <= lowRecoveryThreshold).length /
        nonLowCalDays.length
      : null;

  const lowCal_vs_nonLowCal_lowRecovery_diff =
    low_calorie_low_recovery_rate != null && nonLowCalLowRecoveryRate != null
      ? low_calorie_low_recovery_rate - nonLowCalLowRecoveryRate
      : null;

  const proteinRecoveryPairs = daily
    .filter((r) => r.protein_g != null && r.recovery_score != null)
    .map((r) => [r.protein_g as number, r.recovery_score as number] as [number, number]);

  const protein_vs_recovery_corr = proteinRecoveryPairs.length >= 8 ? pearsonCorr(proteinRecoveryPairs) : null;
  const protein_vs_recovery_corr_n = proteinRecoveryPairs.length;

  // Macro imbalance: compare day-level kcal-shares vs 1/3-1/3-1/3 (rough heuristic).
  const macroImbalanceScores: number[] = [];
  for (const r of daily) {
    if (r.protein_g == null || r.carbs_g == null || r.fat_g == null) continue;
    const proteinKcal = r.protein_g * 4;
    const carbsKcal = r.carbs_g * 4;
    const fatKcal = r.fat_g * 9;
    const total = proteinKcal + carbsKcal + fatKcal;
    if (!Number.isFinite(total) || total <= 0) continue;

    const ps = proteinKcal / total;
    const cs = carbsKcal / total;
    const fs = fatKcal / total;

    const dev = Math.max(Math.abs(ps - 1 / 3), Math.abs(cs - 1 / 3), Math.abs(fs - 1 / 3));
    macroImbalanceScores.push(dev);
  }
  const macro_imbalance_score =
    macroImbalanceScores.length > 0 ? macroImbalanceScores.reduce((a, b) => a + b, 0) / macroImbalanceScores.length : 0;

  const recoveryPresentDays = daily.filter((r) => r.recovery_score != null).length;
  const nutritionPresentDays = daily.filter((r) => r.calories_kcal != null && r.strain != null).length;

  const data_density = clamp(
    (recoveryPresentDays / windowDays) * 0.6 + (nutritionPresentDays / windowDays) * 0.4,
    0,
    1
  );

  // Priority strengths (0..1-ish), then deterministic confidence.
  const late_meal_strength = clamp(late_meal_penalty / 20, 0, 1);
  const calories_alignment_strength = clamp(
    (calories_vs_strain_corr != null ? Math.abs(calories_vs_strain_corr) / 0.6 : 0) * 0.6 +
      (lowCal_vs_nonLowCal_lowRecovery_diff != null ? Math.abs(lowCal_vs_nonLowCal_lowRecovery_diff) / 0.3 : 0) * 0.4,
    0,
    1
  );
  const sleep_strength = clamp(
    (sleep_recovery_corr != null ? Math.abs(sleep_recovery_corr) / 0.6 : 0),
    0,
    1
  );
  const macro_strength = clamp(macro_imbalance_score * 3, 0, 1);

  const signal_strength = clamp(
    late_meal_strength * 0.45 +
      calories_alignment_strength * 0.30 +
      sleep_strength * 0.20 +
      macro_strength * 0.05,
    0,
    1
  );

  const confidence = clamp(signal_strength * data_density, 0, 1);

  // Anti-repetition: compare against last 3 saved insights (normalized columns only).
  const { data: recentRows } = await supabase
    .from("daily_insights")
    .select("insight_text")
    .eq("user_id", user_id)
    .order("date", { ascending: false })
    .limit(3) as { data: DailyInsightsRow[] | null; error?: any };

  const recentInsights = (recentRows ?? [])
    .map((r) => r.insight_text ?? "")
    .filter(Boolean);

  const recentThemes = recentInsights.map((t) => extractThemes(t));

  const computedSignals = {
    window_start: windowStart,
    window_end: windowEnd,
    n_days: windowDays,
    // Core correlations/differences requested
    sleep_recovery_corr: sleep_recovery_corr ?? 0,
    sleep_recovery_corr_n,
    late_meal_recovery_diff: late_meal_recovery_diff ?? 0,
    late_meal_penalty,
    late_meal_true_n: lateTrue.length,
    late_meal_false_n: lateFalse.length,
    calories_vs_strain_corr: calories_vs_strain_corr ?? 0,
    calories_vs_strain_corr_n,
    avg_calories,
    low_calorie_days: low_calorie_days_count,
    low_calorie_low_recovery_rate: low_calorie_low_recovery_rate ?? 0,
    lowCal_vs_nonLowCal_lowRecovery_diff: lowCal_vs_nonLowCal_lowRecovery_diff ?? 0,
    protein_vs_recovery_corr: protein_vs_recovery_corr ?? 0,
    protein_vs_recovery_corr_n,
    macro_imbalance_score,
    entries_density_avg:
      daily.filter((r) => r.entries_count != null).length > 0
        ? daily.reduce((a, r) => a + (r.entries_count ?? 0), 0) / daily.filter((r) => r.entries_count != null).length
        : null,
    // Density + confidence inputs
    data_density,
    signal_strength,
    confidence,
  };

  // Persist detected signals snapshot for reuse (personal_patterns memory).
  const { error: patternUpsertError } = await supabase
    .from("personal_patterns")
    .upsert(
      {
        user_id,
        pattern_type: "daily_insight_signals",
        pattern_key: patternKey,
        signal_strength:
          typeof computedSignals.signal_strength === "number"
            ? computedSignals.signal_strength
            : null,
        confidence:
          typeof computedSignals.confidence === "number"
            ? computedSignals.confidence
            : null,
        first_seen: date,
        last_seen: date,
        occurrences: 1,
        metadata: { computedSignals },
      },
      { onConflict: "user_id,pattern_key" }
    );

  if (patternUpsertError) {
    console.error(
      "[insights] failed to persist personal_patterns signals",
      patternUpsertError
    );
  }

  const previousThemesText = recentInsights.length
    ? recentInsights.map((t) => `- ${t.slice(0, 140)}`).join("\n")
    : "(none)";

  const prompt = [
    "You are a high-performance health analyst.",
    "",
    "You are given:",
    "- daily health data (sleep, recovery, strain)",
    "- nutrition (calories, macros)",
    "- behavioral signals (late meals)",
    "",
    "Computed signals (use these numbers/relationships explicitly):",
    JSON.stringify(computedSignals),
    "",
    "Your job:",
    "- find NON-OBVIOUS patterns",
    "- prioritize actionable insights",
    "- DO NOT repeat generic statements like 'sleep improves recovery'",
    "",
    "Priority order (when choosing which insights to write):",
    "1) late_meal impact",
    "2) calorie deficit / surplus proxies (low calorie vs low recovery, plus calories vs strain alignment)",
    "3) sleep (ONLY if strong signal)",
    "4) macro imbalance",
    "",
    "Rules:",
    "- Output MAX 2 insights",
    "- Each must be specific to the data",
    "- Must reference actual signals above (not generic advice)",
    "- If weak signal -> explicitly say so",
    `- Confidence must be EXACTLY: ${confidence}`,
    "",
    "- Anti-repetition rule: do not reuse the same main theme(s) from the last 3 saved insights:",
    previousThemesText,
    "",
    "Return JSON exactly with:",
    '{ "insight_text": string, "hypothesis": string, "confidence": number }',
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return JSON only. No markdown. No extra keys." },
      { role: "user", content: prompt },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content ?? "";
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_e) {
    // Hard fallback for unexpected model output.
    parsed = {
      insight_text: "Not enough structured signal to form a strong, non-repetitive insight yet.",
      hypothesis: "Focus on tracking consistently (entries_count) and revisit after more days accumulate.",
      confidence,
    };
  }

  let insight_text = typeof parsed?.insight_text === "string" ? parsed.insight_text.trim() : "";
  let hypothesis = typeof parsed?.hypothesis === "string" ? parsed.hypothesis.trim() : "";

  if (!insight_text) {
    insight_text = "Signal is weak or inconsistent; consider improving tracking quality and try again later.";
  }
  if (!hypothesis) {
    hypothesis = "With more consistent data, this pattern may become clearer.";
  }

  // Enforce anti-repetition in JS: compare the model text to last 3 themes.
  const candidateThemes = extractThemes(insight_text);
  const maxJaccard = recentThemes.reduce((best, t) => Math.max(best, themeJaccard(candidateThemes, t)), 0);

  if (recentInsights.length > 0 && maxJaccard >= 0.66) {
    // Rewrite once with an explicit anti-repetition directive.
    const rewritePrompt = [
      "Rewrite the insight to avoid repeating the main themes from previous insights.",
      "You MUST focus on a different signal priority than what appears in the previous insights.",
      "",
      `Previous insights (themes to avoid):\n${previousThemesText}`,
      "",
      "Computed signals are still the same; use them to form a fresh, specific, non-generic answer.",
      JSON.stringify(computedSignals),
      "",
      'Return JSON exactly: { "insight_text": string, "hypothesis": string, "confidence": number }',
    ].join("\n");

    const rewriteCompletion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return JSON only. No markdown. No extra keys." },
        { role: "user", content: rewritePrompt },
      ],
    });

    const rewriteRaw = rewriteCompletion.choices?.[0]?.message?.content ?? "";
    let rewriteParsed: any = null;
    try {
      rewriteParsed = JSON.parse(rewriteRaw);
    } catch (_e) {
      rewriteParsed = parsed;
    }

    const rewriteInsightText =
      typeof rewriteParsed?.insight_text === "string" ? rewriteParsed.insight_text.trim() : insight_text;
    const rewriteHypothesis =
      typeof rewriteParsed?.hypothesis === "string" ? rewriteParsed.hypothesis.trim() : hypothesis;

    const rewriteThemes = extractThemes(rewriteInsightText);
    const rewriteMaxJaccard = recentThemes.reduce(
      (best, t) => Math.max(best, themeJaccard(rewriteThemes, t)),
      0
    );

    // Still too repetitive -> skip overwriting.
    if (rewriteMaxJaccard >= 0.66) {
      console.log("[insights] skipped repetitive insight", {
        user_id,
        date,
        maxJaccard,
        rewriteMaxJaccard,
      });
      return {
        ok: true,
        result: {
          skipped: true,
          reason: "repetitive_insight",
          confidence,
        },
      };
    }

    insight_text = rewriteInsightText;
    hypothesis = rewriteHypothesis;
  }

  // Enforce confidence deterministically (JS-computed): no randomness from the model.
  const finalConfidence = confidence;

  console.log("[insights] generated", {
    user_id,
    date,
    insight_text,
    hypothesis,
    confidence: finalConfidence,
  });

  const nowIso = new Date().toISOString();
  const { error: upsertError } = await supabase
    .from("daily_insights")
    .upsert(
      {
        user_id,
        date,
        window_end_at: nowIso,
        provider: "analysis_js+llm",
        model: OPENAI_MODEL,
        insight_text,
        hypothesis,
        confidence: finalConfidence,
      },
      { onConflict: "user_id,date" }
    );

  if (upsertError) throw upsertError;

  return {
    ok: true,
    result: {
      insight_text,
      hypothesis,
      confidence: finalConfidence,
      computedSignals,
    },
  };
}

