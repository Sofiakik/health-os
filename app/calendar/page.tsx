"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import heic2any from "heic2any";
import { supabase } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

type NoteType = "meal" | "symptom" | "state";
type MealType = "breakfast" | "lunch" | "dinner" | "snack";

type Entry = {
  id: string;
  date: string;
  note: string | null;
  note_type: NoteType | null;
  meal_type: MealType | null;
  image_url: string | null;
  created_at: string;
};

type DailyInsightRow = {
  id: string;
  day: string;
  created_at: string;
  insight: {
    text?: string;
    [key: string]: unknown;
  } | null;
};

const BUCKET = "entry-images";

const today = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const labelNoteType: Record<NoteType, string> = {
  meal: "Meal",
  symptom: "Symptom",
  state: "State",
};

const labelMealType: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

function SignedImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 60 * 60); // 1 hour

      setUrl(data?.signedUrl ?? null);
    };

    load();
  }, [path]);

  if (!url) return null;

  return (
    <img
      src={url}
      alt="entry"
      style={{ maxWidth: "100%", borderRadius: 8 }}
    />
  );
}


export default function CalendarPage() {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [userId, setUserId] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState(today());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(true);

  const [latestInsight, setLatestInsight] = useState<DailyInsightRow | null>(null);
  const [loadingInsight, setLoadingInsight] = useState(true);
  const [generatingInsight, setGeneratingInsight] = useState(false);

  const [noteType, setNoteType] = useState<NoteType>("meal");
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [insightError, setInsightError] = useState("");

  useEffect(() => {
    const init = async () => {
      const { data, error } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;

      if (error || !uid) {
        router.replace("/login");
        return;
      }

      setUserId(uid);
    };

    init();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id;

      if (!uid) {
        router.replace("/login");
        return;
      }

      setUserId(uid);
    });

    return () => sub.subscription.unsubscribe();
  }, [router]);

  const fetchEntries = async (uid: string, date: string) => {
    setLoadingEntries(true);
    setError("");

    const { data, error } = await supabase
      .from("entries")
      .select("id,date,note,note_type,meal_type,image_url,created_at")
      .eq("user_id", uid)
      .eq("date", date)
      .order("created_at", { ascending: false });

    if (error) {
      setEntries([]);
      setError(error.message);
    } else {
      setEntries((data ?? []) as Entry[]);
    }

    setLoadingEntries(false);
  };

  const fetchLatestInsight = async (uid: string) => {
    setLoadingInsight(true);
    setInsightError("");

    const { data, error } = await supabase
      .from("daily_insights")
      .select("id,day,created_at,insight")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      setLatestInsight(null);
      setInsightError(error.message);
    } else {
      setLatestInsight((data as DailyInsightRow | null) ?? null);
    }

    setLoadingInsight(false);
  };

  useEffect(() => {
    if (!userId) return;
    fetchEntries(userId, selectedDate);
  }, [userId, selectedDate]);

  useEffect(() => {
    if (!userId) return;
    fetchLatestInsight(userId);
  }, [userId]);

  const uploadIfAny = async (uid: string, date: string) => {
    if (!file) return null;
  
    let uploadFile: File = file;
  
    // convert HEIC → JPG
    if (file.type === "image/heic" || file.name.toLowerCase().endsWith(".heic")) {
      const converted = await heic2any({
        blob: file,
        toType: "image/jpeg",
        quality: 0.9,
      });
  
      const blob = Array.isArray(converted) ? converted[0] : converted;
  
      uploadFile = new File([blob as Blob], file.name.replace(/\.heic$/i, ".jpg"), {
        type: "image/jpeg",
      });
    }
  
    const ext = uploadFile.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${uid}/${date}/${crypto.randomUUID()}.${ext}`;
  
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, uploadFile, { upsert: false });
  
    if (error) throw error;
  
    // store only the path (not public URL)
    return path;
  };

  const saveEntry = async () => {
    if (!userId || saving) return;

    const hasText = note.trim().length > 0;
    const hasImage = !!file;

    if (!hasText && !hasImage) return;

    setSaving(true);
    setError("");

    try {
      const imageUrl = await uploadIfAny(userId, selectedDate);

      const payload = {
        user_id: userId,
        date: selectedDate,
        note: hasText ? note.trim() : null,
        note_type: noteType,
        meal_type: noteType === "meal" ? mealType : null,
        image_url: imageUrl,
      };

      const { error } = await supabase.from("entries").insert(payload);
      if (error) throw error;

      setNote("");
      setFile(null);
      await fetchEntries(userId, selectedDate);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const generateInsights = async () => {
    setGeneratingInsight(true);
    setInsightError("");

    try {
      const { data, error } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      if (error || !accessToken) {
        throw new Error("No active session found");
      }

      const response = await fetch("/api/insights/run", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body?.error || "Failed to generate insights");
      }

      if (userId) {
        await fetchLatestInsight(userId);
      }
    } catch (e: any) {
      setInsightError(e?.message ?? "Failed to generate insights");
    } finally {
      setGeneratingInsight(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;

    if (e.metaKey) {
      e.preventDefault();

      const el = textareaRef.current;
      if (!el) return;

      const start = el.selectionStart ?? note.length;
      const end = el.selectionEnd ?? note.length;

      const next = note.slice(0, start) + "\n" + note.slice(end);
      const nextPos = start + 1;

      setNote(next);

      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = nextPos;
      });

      return;
    }

    e.preventDefault();
    saveEntry();
  };

  if (!userId) {
    return <p style={{ padding: 24 }}>Loading…</p>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Calendar</h2>
        <button onClick={signOut} style={{ marginLeft: "auto" }}>
          Sign out
        </button>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          padding: 12,
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 10,
          }}
        >
          <h3 style={{ margin: 0 }}>Latest insight</h3>
          <button onClick={generateInsights} disabled={generatingInsight} style={{ marginLeft: "auto" }}>
            {generatingInsight ? "Generating…" : "Generate insights"}
          </button>
        </div>

        {loadingInsight ? (
          <p>Loading insight…</p>
        ) : latestInsight ? (
          <>
            <p style={{ fontSize: 12, opacity: 0.6, marginTop: 0 }}>
              For day {latestInsight.day} · generated {new Date(latestInsight.created_at).toLocaleString()}
            </p>
            <div style={{ whiteSpace: "pre-wrap" }}>
              {latestInsight.insight?.text || "No text in insight"}
            </div>
          </>
        ) : (
          <p style={{ opacity: 0.7 }}>No insights generated yet.</p>
        )}

        {insightError && <p style={{ color: "red", marginTop: 10 }}>{insightError}</p>}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Date</span>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Type</span>
          <select value={noteType} onChange={(e) => setNoteType(e.target.value as NoteType)}>
            <option value="meal">{labelNoteType.meal}</option>
            <option value="symptom">{labelNoteType.symptom}</option>
            <option value="state">{labelNoteType.state}</option>
          </select>
        </label>

        {noteType === "meal" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Meal time</span>
            <select value={mealType} onChange={(e) => setMealType(e.target.value as MealType)}>
              <option value="breakfast">{labelMealType.breakfast}</option>
              <option value="lunch">{labelMealType.lunch}</option>
              <option value="dinner">{labelMealType.dinner}</option>
              <option value="snack">{labelMealType.snack}</option>
            </select>
          </label>
        )}
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          padding: 12,
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          placeholder="Write note… (Enter = save, Cmd+Enter = new line)"
          style={{ width: "100%", minHeight: 90, marginBottom: 10 }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button onClick={saveEntry} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          {file && <span style={{ fontSize: 12, opacity: 0.7 }}>{file.name}</span>}
        </div>

        {error && <p style={{ color: "red", marginTop: 10 }}>{error}</p>}
      </div>

      <h3 style={{ marginTop: 0 }}>Entries for {selectedDate}</h3>

      {loadingEntries ? (
        <p>Loading…</p>
      ) : entries.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No entries yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {entries.map((e) => (
            <div key={e.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <strong>{e.note_type ? labelNoteType[e.note_type] : "Entry"}</strong>
                {e.note_type === "meal" && e.meal_type && (
                  <span style={{ fontSize: 12, opacity: 0.7 }}>• {labelMealType[e.meal_type]}</span>
                )}
                <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.6 }}>
                  {new Date(e.created_at).toLocaleString()}
                </span>
              </div>

              {e.note && (
                <p style={{ whiteSpace: "pre-wrap", marginTop: 8, marginBottom: 8 }}>{e.note}</p>
              )}

              {e.image_url && <SignedImage path={e.image_url} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}