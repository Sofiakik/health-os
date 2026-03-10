"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type NoteType = "meal" | "symptom" | "state";
type MealType = "breakfast" | "lunch" | "dinner" | "snack";

type EntryRow = {
  id: string;
  user_id: string;
  date: string;
  event_time: string | null;
  note: string | null;
  note_type: NoteType;
  meal_type: string | null;
  image_path: string | null;
  image_url?: string | null; // legacy fallback only
  created_at: string;
  portion_grams: number | null;
  calories_kcal: number | null;
  calories_source: string | null;
};

type EntryView = EntryRow & {
  signed_image_url: string | null;
  is_heic_asset: boolean;
};

type Dialogue = {
  role: "user" | "assistant";
  message: string;
};

type Insight = {
  id: string;
  insight: {
    text?: string;
    start_date?: string;
    end_date?: string;
    summary?: string;
    domains?: Record<string, string>;
    actions?: string[];
    confidence?: number;
  };
};

type WhoopDay = {
  sleep_duration: number | null; // stored in hours in daily_health_summary
  recovery_score: number | null;
  hrv: number | null;
  resting_hr: number | null;
  strain: number | null;
  respiratory_rate: number | null;
  skin_temperature: number | null;
  blood_oxygen: number | null;
  deep_sleep_duration: number | null;
  rem_sleep_duration: number | null;
  sleep_efficiency: number | null;
  active_calories: number | null;
};

const ENTRY_IMAGES_BUCKET = "entry-images";

function todayLocal(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateTimeInputValue(dateStr: string): string {
  return `${dateStr}T12:00`;
}

function formatTime(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSleepHours(hours: number | null): string {
  if (hours == null) return "—";
  const wholeHours = Math.floor(hours);
  const minutes = Math.round((hours - wholeHours) * 60);
  return `${wholeHours}h ${minutes}m`;
}

function formatNumber(value: number | null, digits = 0): string {
  if (value == null) return "—";
  return Number(value).toFixed(digits);
}

function stripLegacyImagePath(value: string | null | undefined): string | null {
  if (!value) return null;

  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return value;
  }

  const publicMarker = `/storage/v1/object/public/${ENTRY_IMAGES_BUCKET}/`;
  const signMarker = `/storage/v1/object/sign/${ENTRY_IMAGES_BUCKET}/`;

  if (value.includes(publicMarker)) {
    const path = value.split(publicMarker)[1];
    return path ? path.split("?")[0] : null;
  }

  if (value.includes(signMarker)) {
    const path = value.split(signMarker)[1];
    return path ? path.split("?")[0] : null;
  }

  return null;
}

function isHeicFileName(value: string | null | undefined): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  return lower.endsWith(".heic") || lower.endsWith(".heif");
}

async function createSignedImageUrl(path: string | null): Promise<string | null> {
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(ENTRY_IMAGES_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error) {
    console.error("createSignedUrl failed", error);
    return null;
  }

  return data?.signedUrl ?? null;
}

async function convertAndCompressImage(file: File): Promise<File> {
  const lower = file.name.toLowerCase();
  const isHeic =
    file.type.includes("heic") ||
    lower.endsWith(".heic") ||
    lower.endsWith(".heif");

  let blob: Blob = file;

  if (isHeic) {
    try {
      const { default: heic2any } = await import("heic2any");

      const converted = await heic2any({
        blob: file,
        toType: "image/jpeg",
        quality: 0.9,
      });

      blob = Array.isArray(converted) ? converted[0] : converted;

      if (!blob) {
        throw new Error("HEIC conversion returned empty output.");
      }
    } catch (error) {
      console.error("HEIC conversion failed", error);
      throw new Error(
        "This HEIC image could not be processed in the browser. Please convert it to JPG first or upload a PNG/JPG."
      );
    }
  }

  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(blob);
  } catch (error) {
    console.error("createImageBitmap failed", error);
    throw new Error("Image decoding failed.");
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Could not create canvas context.");
  }

  const MAX_WIDTH = 1600;
  const scale = bitmap.width > MAX_WIDTH ? MAX_WIDTH / bitmap.width : 1;

  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  let quality = 0.9;
  let compressed: Blob | null = null;

  do {
    compressed = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    quality -= 0.1;
  } while (compressed && compressed.size > 400_000 && quality > 0.3);

  if (!compressed) {
    throw new Error("Image compression failed.");
  }

  return new File([compressed], `${crypto.randomUUID()}.jpg`, {
    type: "image/jpeg",
  });

export default function CalendarPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayLocal());

  const [entries, setEntries] = useState<EntryView[]>([]);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [dialogue, setDialogue] = useState<Dialogue[]>([]);
  const [whoop, setWhoop] = useState<WhoopDay | null>(null);

  const [noteType, setNoteType] = useState<NoteType>("meal");
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [note, setNote] = useState<string>("");
  const [eventTimeInput, setEventTimeInput] = useState<string>(localDateTimeInputValue(todayLocal()));
  const [file, setFile] = useState<File | null>(null);

  const [question, setQuestion] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const fileLabel = useMemo(() => file?.name ?? "No file selected", [file]);

  useEffect(() => {
    setEventTimeInput(localDateTimeInputValue(selectedDate));
  }, [selectedDate]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.error("getSession failed", error);
        if (!cancelled) setPageError("Could not load session.");
        return;
      }

      const uid = data.session?.user?.id;

      if (!uid) {
        router.replace("/login");
        return;
      }

      if (!cancelled) {
        setUserId(uid);
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const loadDayData = async (uid: string, date: string) => {
    setLoading(true);
    setPageError(null);

    try {
      const [entriesRes, insightRes, whoopRes] = await Promise.all([
        supabase
          .from("entries")
          .select(
            "id,user_id,date,event_time,note,note_type,meal_type,image_path,image_url,created_at,portion_grams,calories_kcal,calories_source"
          )
          .eq("user_id", uid)
          .eq("date", date)
          .order("event_time", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true }),

        supabase
          .from("daily_insights")
          .select("id,insight")
          .eq("user_id", uid)
          .eq("date", date)
          .maybeSingle(),

        supabase
          .from("daily_health_summary")
          .select(
            `
            sleep_duration,
            recovery_score,
            hrv,
            resting_hr,
            strain,
            respiratory_rate,
            skin_temperature,
            blood_oxygen,
            deep_sleep_duration,
            rem_sleep_duration,
            sleep_efficiency,
            active_calories
          `
          )
          .eq("user_id", uid)
          .eq("date", date)
          .maybeSingle(),
      ]);

      if (entriesRes.error) throw entriesRes.error;
      if (insightRes.error) throw insightRes.error;
      if (whoopRes.error) throw whoopRes.error;

      const rawEntries = (entriesRes.data ?? []) as EntryRow[];

      const viewEntries: EntryView[] = await Promise.all(
        rawEntries.map(async (entry) => {
          const canonicalPath = entry.image_path ?? stripLegacyImagePath(entry.image_url);
          const signedUrl = await createSignedImageUrl(canonicalPath);

          return {
            ...entry,
            signed_image_url: signedUrl,
            is_heic_asset: isHeicFileName(canonicalPath ?? entry.image_url),
          };
        })
      );

      setEntries(viewEntries);
      setInsight((insightRes.data as Insight | null) ?? null);

      if (insightRes.data?.id) {
        const dialogueRes = await supabase
          .from("insight_dialogue")
          .select("role,message")
          .eq("insight_id", insightRes.data.id)
          .order("created_at", { ascending: true });

        if (dialogueRes.error) throw dialogueRes.error;

        setDialogue((dialogueRes.data ?? []) as Dialogue[]);
      } else {
        setDialogue([]);
      }

      const whoopData = whoopRes.data as Partial<WhoopDay> | null;

      setWhoop(
        whoopData
          ? {
              sleep_duration:
                whoopData.sleep_duration != null ? Number(whoopData.sleep_duration) : null,
              recovery_score:
                whoopData.recovery_score != null ? Number(whoopData.recovery_score) : null,
              hrv: whoopData.hrv != null ? Number(whoopData.hrv) : null,
              resting_hr:
                whoopData.resting_hr != null ? Number(whoopData.resting_hr) : null,
              strain: whoopData.strain != null ? Number(whoopData.strain) : null,
              respiratory_rate:
                whoopData.respiratory_rate != null ? Number(whoopData.respiratory_rate) : null,
              skin_temperature:
                whoopData.skin_temperature != null ? Number(whoopData.skin_temperature) : null,
              blood_oxygen:
                whoopData.blood_oxygen != null ? Number(whoopData.blood_oxygen) : null,
              deep_sleep_duration:
                whoopData.deep_sleep_duration != null
                  ? Number(whoopData.deep_sleep_duration)
                  : null,
              rem_sleep_duration:
                whoopData.rem_sleep_duration != null ? Number(whoopData.rem_sleep_duration) : null,
              sleep_efficiency:
                whoopData.sleep_efficiency != null ? Number(whoopData.sleep_efficiency) : null,
              active_calories:
                whoopData.active_calories != null ? Number(whoopData.active_calories) : null,
            }
          : null
      );
    } catch (err) {
      console.error("loadDayData failed", err);
      setPageError("Failed to load this day.");
      setEntries([]);
      setInsight(null);
      setDialogue([]);
      setWhoop(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!userId) return;
    void loadDayData(userId, selectedDate);
  }, [userId, selectedDate]);

  const uploadImage = async (
    uid: string,
    date: string,
    inputFile: File
  ): Promise<{ imagePath: string; signedUrl: string | null }> => {
    const processed = await convertAndCompressImage(inputFile);
    const path = `${uid}/${date}/${processed.name}`;

    const { error: uploadError } = await supabase.storage
      .from(ENTRY_IMAGES_BUCKET)
      .upload(path, processed, {
        contentType: processed.type,
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }

    const signedUrl = await createSignedImageUrl(path);

    return {
      imagePath: path,
      signedUrl,
    };
  };

  const saveEntry = async () => {
    if (!userId) return;
    if (!note.trim() && !file) return;

    setSaving(true);
    setPageError(null);

    try {
      let imagePath: string | null = null;

      if (file) {
        const upload = await uploadImage(userId, selectedDate, file);
        imagePath = upload.imagePath;
      }

      const eventTime = eventTimeInput ? new Date(eventTimeInput).toISOString() : null;

      const payload = {
        user_id: userId,
        date: selectedDate,
        event_time: eventTime,
        note: note.trim() || null,
        note_type: noteType,
        meal_type: noteType === "meal" ? mealType : null,
        image_path: imagePath,
        image_url: null, // legacy column intentionally not used for new writes
        portion_grams: null,
        calories_kcal: null,
        calories_source: null,
      };

      const { error } = await supabase.from("entries").insert(payload);

      if (error) {
        throw error;
      }

      setNote("");
      setFile(null);
      setEventTimeInput(localDateTimeInputValue(selectedDate));

      await loadDayData(userId, selectedDate);
    } catch (err) {
      console.error("saveEntry failed", err);

      if (err instanceof Error) {
        setPageError(err.message);
      } else {
        setPageError("Failed to save entry.");
      }
    } finally {
      setSaving(false);
    }
  };

  const sendQuestion = async () => {
    if (!question.trim() || !insight || !userId) return;

    const q = question.trim();
    setQuestion("");

    const optimisticUserMessage: Dialogue = { role: "user", message: q };
    setDialogue((prev) => [...prev, optimisticUserMessage]);
    setChatLoading(true);
    setPageError(null);

    try {
      const res = await fetch("/api/insights/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: userId,
          insight_id: insight.id,
          message: q,
        }),
      });

      if (!res.ok) {
        throw new Error(`Chat request failed with ${res.status}`);
      }

      const data = (await res.json()) as { reply?: string };

      setDialogue((prev) => [
        ...prev,
        { role: "assistant", message: data.reply ?? "No reply returned." },
      ]);
    } catch (err) {
      console.error("sendQuestion failed", err);
      setPageError("Failed to send question.");
      setDialogue((prev) => [
        ...prev,
        { role: "assistant", message: "Sorry — chat failed for this message." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const nextFile = e.target.files?.[0] ?? null;
  
    if (!nextFile) {
      setFile(null);
      return;
    }
  
    const lower = nextFile.name.toLowerCase();
    const isHeic =
      nextFile.type.includes("heic") ||
      lower.endsWith(".heic") ||
      lower.endsWith(".heif");
  
    if (isHeic) {
      setFile(null);
      setPageError(
        "HEIC files are not supported yet. Please convert the image to JPG or PNG before uploading."
      );
      e.target.value = "";
      return;
    }
  
    setPageError(null);
    setFile(nextFile);
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Calendar</h2>
        <button onClick={signOut} style={{ marginLeft: "auto" }}>
          Sign out
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
        />
      </div>

      {pageError ? (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            border: "1px solid #d33",
            borderRadius: 8,
            background: "#fff5f5",
          }}
        >
          {pageError}
        </div>
      ) : null}

      <section style={{ marginTop: 24 }}>
        <h3>WHOOP</h3>

        {loading ? (
          <p>Loading...</p>
        ) : !whoop ? (
          <p>No WHOOP data</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <div>Sleep: {formatSleepHours(whoop.sleep_duration)}</div>
            <div>Recovery: {formatNumber(whoop.recovery_score)}</div>
            <div>HRV: {formatNumber(whoop.hrv, 1)}</div>
            <div>Resting HR: {formatNumber(whoop.resting_hr)}</div>
            <div>Strain: {formatNumber(whoop.strain, 1)}</div>
            <div>Respiratory rate: {formatNumber(whoop.respiratory_rate, 1)}</div>
            <div>Skin temperature: {formatNumber(whoop.skin_temperature, 2)}</div>
            <div>Blood oxygen: {formatNumber(whoop.blood_oxygen, 1)}</div>
            <div>Deep sleep: {formatSleepHours(whoop.deep_sleep_duration)}</div>
            <div>REM sleep: {formatSleepHours(whoop.rem_sleep_duration)}</div>
            <div>Sleep efficiency: {formatNumber(whoop.sleep_efficiency, 1)}</div>
            <div>Active calories: {formatNumber(whoop.active_calories)}</div>
          </div>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h3>Add entry</h3>

        <div style={{ display: "grid", gap: 12 }}>
          <label>
            Type
            <div style={{ marginTop: 4 }}>
              <select
                value={noteType}
                onChange={(e) => setNoteType(e.target.value as NoteType)}
              >
                <option value="meal">Meal</option>
                <option value="symptom">Symptom</option>
                <option value="state">State</option>
              </select>
            </div>
          </label>

          {noteType === "meal" ? (
            <label>
              Meal type
              <div style={{ marginTop: 4 }}>
                <select
                  value={mealType}
                  onChange={(e) => setMealType(e.target.value as MealType)}
                >
                  <option value="breakfast">Breakfast</option>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                  <option value="snack">Snack</option>
                </select>
              </div>
            </label>
          ) : null}

          <label>
            Event time
            <div style={{ marginTop: 4 }}>
              <input
                type="datetime-local"
                value={eventTimeInput}
                onChange={(e) => setEventTimeInput(e.target.value)}
              />
            </div>
          </label>

          <label>
            Note
            <div style={{ marginTop: 4 }}>
              <textarea
                rows={4}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What happened?"
                style={{ width: "100%" }}
              />
            </div>
          </label>

          <label>
            Image
            <div style={{ marginTop: 4 }}>
              <input
                type="file"
                accept="image/*,.heic,.heif"
                onChange={onFileChange}
              />
            </div>

            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
              {fileLabel}
            </div>

            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
              iPhone uploads are supported. If a specific HEIC fails, convert it to JPG and retry.
            </div>
          </label>

          <div>
            <button onClick={saveEntry} disabled={saving}>
              {saving ? "Saving..." : "Save entry"}
            </button>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h3>Entries</h3>

        {loading ? (
          <p>Loading...</p>
        ) : entries.length === 0 ? (
          <p>No entries for this day</p>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {entries.map((entry) => (
              <div
                key={entry.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 10,
                  padding: 14,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <strong>{entry.note_type}</strong>
                  {entry.meal_type ? <span>• {entry.meal_type}</span> : null}
                  <span>• {formatTime(entry.event_time ?? entry.created_at)}</span>
                </div>

                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  Event: {formatDateTime(entry.event_time)} | Recorded: {formatDateTime(entry.created_at)}
                </div>

                {entry.note ? <div>{entry.note}</div> : null}

                {entry.signed_image_url && !entry.is_heic_asset ? (
                  <img
                    src={entry.signed_image_url}
                    alt="Entry"
                    style={{ width: "100%", borderRadius: 8 }}
                  />
                ) : null}

                {entry.is_heic_asset ? (
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      background: "#fff8e6",
                      border: "1px solid #e7c46a",
                      fontSize: 14,
                    }}
                  >
                    This image is stored as HEIC and may not render in Chrome. It should be migrated to JPEG.
                  </div>
                ) : null}

                {entry.calories_kcal != null || entry.portion_grams != null ? (
                  <div style={{ fontSize: 14, opacity: 0.8 }}>
                    {entry.portion_grams != null ? `Portion: ${entry.portion_grams}g` : ""}
                    {entry.portion_grams != null && entry.calories_kcal != null ? " • " : ""}
                    {entry.calories_kcal != null ? `Calories: ${entry.calories_kcal}` : ""}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h3>Insight</h3>

        {!insight ? (
          <p>No insight for this day</p>
        ) : (
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 14,
              whiteSpace: "pre-wrap",
            }}
          >
            {insight.insight?.text ??
              insight.insight?.summary ??
              "Insight exists but no text field was found."}
          </div>
        )}
      </section>

      <section style={{ marginTop: 32, marginBottom: 48 }}>
        <h3>Insight chat</h3>

        <div style={{ display: "grid", gap: 12 }}>
          {dialogue.length === 0 ? (
            <p>No messages yet</p>
          ) : (
            dialogue.map((msg, index) => (
              <div
                key={`${msg.role}-${index}`}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 10,
                  padding: 12,
                  background: msg.role === "user" ? "#f8f8f8" : "#ffffff",
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
                  {msg.role}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{msg.message}</div>
              </div>
            ))
          )}

          <div style={{ display: "grid", gap: 8 }}>
            <textarea
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about today's insight"
              style={{ width: "100%" }}
            />
            <div>
              <button
                onClick={sendQuestion}
                disabled={!insight || chatLoading || !question.trim()}
              >
                {chatLoading ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}