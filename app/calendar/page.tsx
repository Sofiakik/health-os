"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type NoteType = "meal" | "symptom" | "state";
type MealType = "breakfast" | "lunch" | "dinner" | "snack";

type Entry = {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  note: string | null;
  created_at: string;
  photo_url: string | null;
  photo_path: string | null;
  note_type: NoteType;
  meal_type: MealType | null;
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// Monday=0 ... Sunday=6
function mondayIndex(jsDay: number) {
  // JS: Sun=0..Sat=6  ->  Mon=0..Sun=6
  return (jsDay + 6) % 7;
}

const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  meal: "Прием пищи",
  symptom: "Симптом",
  state: "Состояние",
};

const MEAL_TYPE_LABEL: Record<MealType, string> = {
  breakfast: "Завтрак",
  lunch: "Обед",
  dinner: "Ужин",
  snack: "Перекус",
};

export default function CalendarPage() {
  const router = useRouter();

  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => isoDate(new Date()));

  const [noteType, setNoteType] = useState<NoteType>("state");
  const [mealType, setMealType] = useState<MealType>("breakfast");

  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  // Dates in current month that have at least one entry
  const [daysWithEntries, setDaysWithEntries] = useState<Set<string>>(new Set());
  const [loadingMonthDots, setLoadingMonthDots] = useState(false);

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setEmail(data.user.email ?? null);
      setUserId(data.user.id);
    };
    init();
  }, [router]);

  const monthLabel = useMemo(() => {
    return month.toLocaleString(undefined, { month: "long", year: "numeric" });
  }, [month]);

  const monthRange = useMemo(() => {
    const start = startOfMonth(month);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 1); // exclusive
    return { start, end };
  }, [month]);

  const loadEntriesForDate = async (uid: string, d: string) => {
    setLoadingEntries(true);
    setStatus("");

    const { data, error } = await supabase
      .from("entries")
      .select("*")
      .eq("user_id", uid)
      .eq("date", d)
      .order("created_at", { ascending: false });

    setLoadingEntries(false);

    if (error) {
      setStatus("❌ " + error.message);
      return;
    }

    setEntries((data as Entry[]) ?? []);
  };

  const loadMonthDots = async (uid: string) => {
    setLoadingMonthDots(true);

    const start = isoDate(monthRange.start);
    // endExclusive -> last day inclusive for filtering in SQL:
    const endInclusive = isoDate(new Date(monthRange.end.getTime() - 24 * 60 * 60 * 1000));

    const { data, error } = await supabase
      .from("entries")
      .select("date")
      .eq("user_id", uid)
      .gte("date", start)
      .lte("date", endInclusive);

    setLoadingMonthDots(false);

    if (error) {
      setStatus("❌ " + error.message);
      setDaysWithEntries(new Set());
      return;
    }

    const set = new Set<string>();
    (data ?? []).forEach((row: any) => {
      if (row?.date) set.add(row.date);
    });
    setDaysWithEntries(set);
  };

  // whenever we have userId, selectedDate changes -> load entries
  useEffect(() => {
    if (!userId) return;
    loadEntriesForDate(userId, selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, selectedDate]);

  // whenever month changes -> load dots (days with entries)
  useEffect(() => {
    if (!userId) return;
    loadMonthDots(userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, month]);

  const uploadPhoto = async (uid: string) => {
    if (!file) return { photo_url: null as string | null, photo_path: null as string | null };

    const ext = file.name.split(".").pop() || "jpg";
    const filename = `${crypto.randomUUID()}.${ext}`;
    const path = `${uid}/${selectedDate}/${filename}`;

    const { error: uploadError } = await supabase.storage.from("health").upload(path, file, {
      upsert: false,
    });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data } = supabase.storage.from("health").getPublicUrl(path);
    return { photo_url: data.publicUrl, photo_path: path };
  };

  const saveEntry = async () => {
    if (!userId || saving) return;

    const hasContent = note.trim().length > 0 || !!file;
    if (!hasContent) return;

    try {
      setSaving(true);
      setStatus("Saving...");

      const trimmed = note.trim();
      const { photo_url, photo_path } = await uploadPhoto(userId);

      const payload: any = {
        user_id: userId,
        date: selectedDate,
        note: trimmed ? trimmed : null,
        photo_url,
        photo_path,
        note_type: noteType,
        meal_type: noteType === "meal" ? mealType : null,
      };

      const { error } = await supabase.from("entries").insert(payload);

      if (error) {
        setStatus("❌ " + error.message);
        return;
      }

      setStatus("✅ Saved!");
      setNote("");
      setFile(null);

      await loadEntriesForDate(userId, selectedDate);
      await loadMonthDots(userId);
    } catch (e: any) {
      setStatus("❌ " + (e?.message ?? "Upload failed"));
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const goPrevMonth = () => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  const goNextMonth = () => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));

  // Build calendar grid (Mon-Sun)
  const grid = useMemo(() => {
    const first = startOfMonth(month);
    const startOffset = mondayIndex(first.getDay()); // 0..6
    const totalDays = daysInMonth(month);

    const cells: { dateISO: string | null; dayNum: number | null }[] = [];

    for (let i = 0; i < startOffset; i++) cells.push({ dateISO: null, dayNum: null });
    for (let d = 1; d <= totalDays; d++) {
      const dt = new Date(month.getFullYear(), month.getMonth(), d);
      cells.push({ dateISO: isoDate(dt), dayNum: d });
    }
    while (cells.length % 7 !== 0) cells.push({ dateISO: null, dayNum: null });

    return cells;
  }, [month]);

  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ margin: 0 }}>Calendar</h1>
          <div style={{ color: "#666", marginTop: 6 }}>Signed in as: {email ?? "…"}</div>
        </div>
        <button onClick={signOut}>Sign out</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 18 }}>
        {/* Left: Month grid */}
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button onClick={goPrevMonth}>←</button>
            <div style={{ fontWeight: 700 }}>{monthLabel}</div>
            <button onClick={goNextMonth}>→</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginTop: 12 }}>
            {weekdays.map((w) => (
              <div key={w} style={{ fontSize: 12, color: "#666", textAlign: "center" }}>
                {w}
              </div>
            ))}

            {grid.map((cell, idx) => {
              const isSelected = cell.dateISO && cell.dateISO === selectedDate;
              const hasDot = cell.dateISO ? daysWithEntries.has(cell.dateISO) : false;

              return (
                <button
                  key={idx}
                  onClick={() => cell.dateISO && setSelectedDate(cell.dateISO)}
                  disabled={!cell.dateISO}
                  style={{
                    height: 44,
                    borderRadius: 10,
                    border: "1px solid " + (isSelected ? "#000" : "#eee"),
                    background: isSelected ? "#f2f2f2" : "#fff",
                    cursor: cell.dateISO ? "pointer" : "default",
                    position: "relative",
                    opacity: cell.dateISO ? 1 : 0,
                  }}
                >
                  {cell.dayNum}
                  {hasDot && (
                    <span
                      style={{
                        position: "absolute",
                        bottom: 8,
                        left: "50%",
                        transform: "translateX(-50%)",
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: "#111",
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
            {loadingMonthDots ? "Updating month markers…" : " "}
          </div>
        </div>

        {/* Right: Day details */}
        <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Day: {selectedDate}</div>

          <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Add entry</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <label style={{ display: "block" }}>
                Тип заметки
                <select
                  value={noteType}
                  onChange={(e) => setNoteType(e.target.value as NoteType)}
                  style={{ display: "block", marginTop: 6, width: "100%", padding: 8 }}
                >
                  <option value="meal">Прием пищи</option>
                  <option value="symptom">Симптом</option>
                  <option value="state">Состояние</option>
                </select>
              </label>

              {noteType === "meal" ? (
                <label style={{ display: "block" }}>
                  Прием пищи
                  <select
                    value={mealType}
                    onChange={(e) => setMealType(e.target.value as MealType)}
                    style={{ display: "block", marginTop: 6, width: "100%", padding: 8 }}
                  >
                    <option value="breakfast">Завтрак</option>
                    <option value="lunch">Обед</option>
                    <option value="dinner">Ужин</option>
                    <option value="snack">Перекус</option>
                  </select>
                </label>
              ) : (
                <div />
              )}
            </div>

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                // Enter = Save, Cmd+Enter = newline
                if (e.key === "Enter" && !e.metaKey) {
                  e.preventDefault();
                  const hasContent = note.trim().length > 0 || !!file;
                  if (hasContent && !saving) saveEntry();
                }
              }}
              rows={3}
              style={{ width: "100%", padding: 10 }}
              placeholder="Напиши заметку…"
            />

            <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
              Enter — сохранить · ⌘+Enter — новая строка
            </div>

            <div style={{ marginTop: 10 }}>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
                  Selected: {file.name}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
              <button onClick={saveEntry} disabled={!userId || saving}>
                {saving ? "Saving..." : "Save"}
              </button>
              <div style={{ fontSize: 14 }}>{status}</div>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Entries</div>

            {loadingEntries && <div>Loading…</div>}
            {!loadingEntries && entries.length === 0 && <div style={{ color: "#666" }}>No entries yet.</div>}

            {!loadingEntries && entries.length > 0 && (
              <div style={{ display: "grid", gap: 10 }}>
                {entries.map((e) => (
                  <div key={e.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 12, color: "#666" }}>
                      {new Date(e.created_at).toLocaleString()}
                      {" · "}
                      <b>{NOTE_TYPE_LABEL[e.note_type]}</b>
                      {e.note_type === "meal" && e.meal_type ? ` · ${MEAL_TYPE_LABEL[e.meal_type]}` : ""}
                    </div>

                    <div style={{ marginTop: 6 }}>{e.note ?? <i>(empty)</i>}</div>

                    {e.photo_url && (
                      <img
                        src={e.photo_url}
                        alt="entry photo"
                        style={{
                          marginTop: 10,
                          width: "100%",
                          borderRadius: 10,
                          border: "1px solid #eee",
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}