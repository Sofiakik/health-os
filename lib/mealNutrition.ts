import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ENTRY_IMAGES_BUCKET = "entry-images";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.2";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

type MealNutritionResult = {
  calories_kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  confidence: number | null;
  notes: string;
};

function coerceNullableNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function processMealEntry(params: { entry_id: string; user_id: string }) {
  const { entry_id, user_id } = params;

  console.log("[nutrition] START", { entry_id });

  // Use service role to bypass RLS; still verify ownership to prevent cross-user processing.
  const { data: entry, error: entryError } = await supabaseAdmin
    .from("entries")
    .select("id,user_id,note,image_path,nutrition_extracted_at,nutrition_confidence")
    .eq("id", entry_id)
    .eq("user_id", user_id)
    .maybeSingle();

  if (entryError) throw entryError;
  if (!entry) return { skipped: true, reason: "not_found_or_not_owned" as const };

  // Idempotency:
  // - If already extracted with high confidence, skip.
  // - Otherwise (low confidence or missing confidence), allow reprocessing.
  if (entry.nutrition_extracted_at) {
    const c =
      typeof entry.nutrition_confidence === "number"
        ? entry.nutrition_confidence
        : entry.nutrition_confidence == null
          ? null
          : Number(entry.nutrition_confidence);

    if (c != null && Number.isFinite(c) && c >= 0.6) {
      return { skipped: true, reason: "already_extracted_high_confidence" as const };
    }
  }

  const signedUrl = entry.image_path
    ? await (async () => {
        const { data, error } = await supabaseAdmin.storage
          .from(ENTRY_IMAGES_BUCKET)
          .createSignedUrl(entry.image_path, 60 * 60);

        if (error) return null;
        return data?.signedUrl ?? null;
      })()
    : null;

  if (entry.image_path) {
    // Avoid logging the full pre-signed URL (treat as secret); log only minimal metadata.
    console.log("[nutrition] signed URL", {
      present: Boolean(signedUrl),
      length: signedUrl?.length ?? 0,
    });
  }

  const systemPrompt = `
You MUST return ONLY valid JSON.
Do NOT include markdown.
Do NOT include explanations.
Do NOT wrap in \`\`\`.

If you do not follow this, the system will fail.

Return exactly:
{
  "calories_kcal": number | null,
  "protein_g": number | null,
  "carbs_g": number | null,
  "fat_g": number | null,
  "confidence": number,
  "notes": string
}
`;

  const userText = [
    `Analyze this meal and return JSON with:
• calories_kcal
• protein_g
• carbs_g
• fat_g`,
    "",
    systemPrompt.trim(),
    "",
    "USER INPUT:",
    `- note: ${entry.note ? String(entry.note) : "(none)"}`,
    `- image: ${signedUrl ? "(provided)" : "(not provided)"}`,
  ].join("\n");

  try {
    const userContent: Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; detail: "auto"; image_url: string }
    > = [{ type: "input_text", text: userText }];

    if (signedUrl) {
      userContent.push({
        type: "input_image",
        detail: "auto",
        image_url: signedUrl,
      });
    }

    const response = await openai.responses.create({
      model: OPENAI_MODEL,
      input: [
        {
          role: "user",
          content: userContent,
        },
      ],
      text: { format: { type: "json_object" } },
    });

    const outputText = response.output_text;
    console.log("[nutrition] raw response:", outputText);

    // 1) Parse response safely (strip any markdown fences just in case)
    let parsed: any;
    try {
      const cleaned = outputText
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("[nutrition] JSON parse failed:", outputText);
      console.warn("[nutrition] SKIPPED", {
        entry_id,
        reason: "json_parse_failed",
        parsed,
      });
      return { skipped: true, reason: "json_parse_failed" as const };
    }

    console.log("[nutrition] parsed", parsed);

    // 2) Validate structure
    const isValid =
      typeof parsed === "object" &&
      parsed !== null &&
      "calories_kcal" in parsed &&
      "protein_g" in parsed &&
      "carbs_g" in parsed &&
      "fat_g" in parsed;

    if (!isValid) {
      console.error("[nutrition] invalid structure", parsed);
      console.warn("[nutrition] SKIPPED", {
        entry_id,
        reason: "invalid_structure",
        parsed,
      });
      return { skipped: true, reason: "invalid_structure" as const };
    }

    // 3) Extract
    const {
      calories_kcal,
      protein_g,
      carbs_g,
      fat_g,
      confidence,
      notes,
    } = parsed as {
      calories_kcal: number | null;
      protein_g: number | null;
      carbs_g: number | null;
      fat_g: number | null;
      confidence?: number;
      notes?: string;
    };

    const confidenceOrNull =
      typeof confidence === "number" && Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : null;

    const notesOrNull = typeof notes === "string" ? notes : null;

    const result: MealNutritionResult = {
      calories_kcal: coerceNullableNumber(calories_kcal),
      protein_g: coerceNullableNumber(protein_g),
      carbs_g: coerceNullableNumber(carbs_g),
      fat_g: coerceNullableNumber(fat_g),
      confidence: confidenceOrNull,
      notes: notesOrNull ?? "",
    };

    console.log("[nutrition] processed", {
      entry_id,
      calories_kcal: result.calories_kcal,
      protein_g: result.protein_g,
      carbs_g: result.carbs_g,
      fat_g: result.fat_g,
      confidence: result.confidence,
    });

    const isMeaningful =
      result.calories_kcal !== null ||
      result.protein_g !== null ||
      result.carbs_g !== null ||
      result.fat_g !== null;

    if (!isMeaningful) {
      console.warn("[nutrition] empty result, skipping write", { entry_id });
      console.warn("[nutrition] SKIPPED", {
        entry_id,
        reason: "empty_result",
        parsed,
      });
      return { skipped: true, reason: "empty_result" as const };
    }

    // 4) Update DB ONLY if parsing succeeded
    const { error: updateError } = await supabaseAdmin
      .from("entries")
      .update({
        calories_kcal: result.calories_kcal,
        protein_g: result.protein_g,
        carbs_g: result.carbs_g,
        fat_g: result.fat_g,
        nutrition_confidence: confidenceOrNull,
        nutrition_notes: notesOrNull,
        nutrition_extracted_at: new Date().toISOString(),
      })
      .eq("id", entry_id)
      .eq("user_id", user_id);

    if (updateError) throw updateError;

    console.log("[nutrition] saved to DB", {
      entry_id,
      calories_kcal: result.calories_kcal,
      protein_g: result.protein_g,
      carbs_g: result.carbs_g,
      fat_g: result.fat_g,
      confidence: confidenceOrNull,
    });

    console.log("[nutrition] DB update result", { error: updateError });

    return { skipped: false, result };
  } catch (e: any) {
    // Network / OpenAI failure: do NOT mark extracted to allow retry.
    console.error("[nutrition] processing failed", e);
    return { skipped: true, reason: "openai_or_runtime_error" as const };
  }
}

