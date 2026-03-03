"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type NoteType = "meal" | "symptom" | "condition";
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
  condition: "Condition",
};

const labelMealType: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export default function CalendarPage() {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [userId, setUserId] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState(today());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const [noteType, setNoteType] = useState<NoteType>("meal");
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    const init = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!alive) return;

      const uid = data.session?.user?.id;
      if (error || !uid) {
        router.replace("/login");
        return;
      }
      setUserId(uid);
    };

    init();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const uid = session?.user?.id;
      if (!uid) router.replace("/login");
      else setUserId(uid);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  const fetchEntries = async (uid: string, date: string) => {
    setLoading(true);
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

    setLoading(false);
  };

  useEffect(() => {
    if (!userId) return;
    fetchEntries(userId, selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, selectedDate]);

  const uploadIfAny = async (uid: string, date: string) => {
    if (!file) return null;

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${uid}/${date}/${crypto.randomUUID()}.${ext}`;

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
    if (upErr) throw upErr;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl ?? null;
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
        note_type: noteType, // lowercase enum value
        meal_type: noteType === "meal" ? mealType : null, // lowercase enum value
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

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  // Enter = save, Cmd+Enter = newline
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

  if (!userId) return <p style={{ padding: 24 }}>Loading…</p>;

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Calendar</h2>
        <button onClick={signOut} style={{ marginLeft: "auto" }}>
          Sign out
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Date</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Type</span>
          <select value={noteType} onChange={(e) => setNoteType(e.target.value as NoteType)}>
            <option value="meal">{labelNoteType.meal}</option>
            <option value="symptom">{labelNoteType.symptom}</option>
            <option value="condition">{labelNoteType.condition}</option>
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

      <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8, marginBottom: 16 }}>
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={onTextareaKeyDown}
          placeholder="Write note… (Enter = save, Cmd+Enter = new line)"
          style={{ width: "100%", minHeight: 90, marginBottom: 10 }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button onClick={saveEntry} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          {file && <span style={{ fontSize: 12, opacity: 0.7 }}>{file.name}</span>}
        </div>

        {error && <p style={{ color: "red", marginTop: 10 }}>{error}</p>}
      </div>

      <h3 style={{ marginTop: 0 }}>Entries for {selectedDate}</h3>

      {loading ? (
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

              {e.note && <p style={{ whiteSpace: "pre-wrap", marginTop: 8, marginBottom: 8 }}>{e.note}</p>}

              {e.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.image_url} alt="entry" style={{ maxWidth: "100%", borderRadius: 8 }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}