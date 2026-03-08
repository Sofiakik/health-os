"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import heic2any from "heic2any";

type NoteType = "meal" | "symptom" | "state";
type MealType = "breakfast" | "lunch" | "dinner" | "snack";

type Entry = {
  id: string;
  user_id: string;
  date: string;
  note: string | null;
  note_type: NoteType | null;
  meal_type: MealType | null;
  image_url: string | null;
  created_at: string;
  portion_grams: number | null;
  calories_kcal: number | null;
  calories_source: string | null;
};

type Dialogue = {
  role: "user" | "assistant";
  message: string;
};

type Insight = {
  id: string;
  insight: {
    text: string;
  };
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function CalendarPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(today());

  const [entries, setEntries] = useState<Entry[]>([]);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [dialogue, setDialogue] = useState<Dialogue[]>([]);

  const [noteType, setNoteType] = useState<NoteType>("meal");
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [question, setQuestion] = useState("");
  const [saving, setSaving] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  /* --------------------------
     AUTH
  -------------------------- */

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;

      if (!uid) {
        router.replace("/login");
        return;
      }

      setUserId(uid);
    };

    init();
  }, [router]);

  /* --------------------------
     LOAD DAY DATA
  -------------------------- */

  const loadDayData = async (uid: string, date: string) => {
    setLoading(true);

    const { data: entryData } = await supabase
      .from("entries")
      .select("*")
      .eq("user_id", uid)
      .eq("date", date)
      .order("created_at", { ascending: true });

    setEntries((entryData ?? []) as Entry[]);

    const { data: insightData } = await supabase
      .from("daily_insights")
      .select("*")
      .eq("user_id", uid)
      .eq("date", date)
      .maybeSingle();

    setInsight(insightData ?? null);

    if (insightData?.id) {
      const { data: dialogueData } = await supabase
        .from("insight_dialogue")
        .select("role,message")
        .eq("insight_id", insightData.id)
        .order("created_at", { ascending: true });

      setDialogue(dialogueData ?? []);
    } else {
      setDialogue([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (!userId) return;
    loadDayData(userId, selectedDate);
  }, [userId, selectedDate]);

  /* --------------------------
     IMAGE UPLOAD
  -------------------------- */

  const uploadImage = async (uid: string, date: string) => {
    if (!file) return null;

    const ext = file.name.split(".").pop();
    const path = `${uid}/${date}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from("entry-images")
      .upload(path, file);

    if (error) throw error;

    const publicUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/entry-images/${path}`;

    return publicUrl;
  };

  /* --------------------------
     SAVE ENTRY
  -------------------------- */

  const saveEntry = async () => {
    if (!userId) return;
    if (!note.trim() && !file) return;

    setSaving(true);

    try {
      const imageUrl = await uploadImage(userId, selectedDate);

      const payload = {
        user_id: userId,
        date: selectedDate,
        note: note.trim() || null,
        note_type: noteType,
        meal_type: noteType === "meal" ? mealType : null,
        image_url: imageUrl,
        portion_grams: null,
        calories_kcal: null,
        calories_source: null
      };

      const { error } = await supabase.from("entries").insert(payload);

      if (error) throw error;

      setNote("");
      setFile(null);

      await loadDayData(userId, selectedDate);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  /* --------------------------
     CHAT
  -------------------------- */

  const sendQuestion = async () => {
    if (!question.trim() || !insight) return;

    const userMsg = { role: "user" as const, message: question };
    setDialogue((d) => [...d, userMsg]);

    const q = question;
    setQuestion("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/insights/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          insight_id: insight.id,
          message: q
        })
      });

      const data = await res.json();

      const assistantMsg = {
        role: "assistant" as const,
        message: data.reply
      };

      setDialogue((d) => [...d, assistantMsg]);
    } catch (e) {
      console.error(e);
    } finally {
      setChatLoading(false);
    }
  };

  /* --------------------------
     SIGN OUT
  -------------------------- */

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  /* --------------------------
     UI
  -------------------------- */

  return (
    <div style={{ maxWidth: 720, margin: "auto", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <h2>Calendar</h2>
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

      {/* ADD ENTRY */}

      <div style={{ marginTop: 24 }}>
        <h3>Add entry</h3>

        <select
          value={noteType}
          onChange={(e) => setNoteType(e.target.value as NoteType)}
        >
          <option value="meal">Meal</option>
          <option value="symptom">Symptom</option>
          <option value="state">State</option>
        </select>

        {noteType === "meal" && (
          <select
            value={mealType}
            onChange={(e) => setMealType(e.target.value as MealType)}
            style={{ marginLeft: 10 }}
          >
            <option value="breakfast">Breakfast</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
            <option value="snack">Snack</option>
          </select>
        )}

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Write note..."
          style={{ width: "100%", marginTop: 10 }}
        />

        <input
          type="file"
          accept="image/*"
          style={{ marginTop: 10 }}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <button
          onClick={saveEntry}
          disabled={saving}
          style={{ marginTop: 10 }}
        >
          {saving ? "Saving..." : "Save entry"}
        </button>
      </div>

      {/* ENTRIES */}

      <div style={{ marginTop: 30 }}>
        <h3>Entries</h3>

        {loading ? (
          <p>Loading...</p>
        ) : entries.length === 0 ? (
          <p>No entries</p>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              style={{
                border: "1px solid #eee",
                padding: 12,
                marginTop: 10,
                borderRadius: 8
              }}
            >
              {e.note_type === "meal" && (
                <strong>{e.meal_type}</strong>
              )}

              <div>{formatTime(e.created_at)}</div>

              {e.note && (
                <p style={{ whiteSpace: "pre-wrap" }}>{e.note}</p>
              )}

              {e.image_url && (
                <img
                  src={e.image_url}
                  style={{ maxWidth: "100%", borderRadius: 8 }}
                />
              )}
            </div>
          ))
        )}
      </div>

      {/* INSIGHT */}

      <div style={{ marginTop: 30 }}>
        <h3>Daily Insight</h3>

        {insight ? (
          <p style={{ whiteSpace: "pre-wrap" }}>
            {insight.insight?.text}
          </p>
        ) : (
          <p>No insight generated yet</p>
        )}
      </div>

      {/* DIALOGUE */}

      {insight && (
        <div style={{ marginTop: 30 }}>
          <h3>Conversation</h3>

          {dialogue.map((m, i) => (
            <div
              key={i}
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 6,
                background:
                  m.role === "assistant"
                    ? "#f5f5f5"
                    : "#e8f3ff"
              }}
            >
              <strong>{m.role === "assistant" ? "Assistant" : "You"}</strong>
              <p style={{ whiteSpace: "pre-wrap" }}>{m.message}</p>
            </div>
          ))}

          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about today's insight..."
            style={{ width: "100%", marginTop: 10 }}
          />

          <button
            onClick={sendQuestion}
            disabled={chatLoading}
            style={{ marginTop: 10 }}
          >
            {chatLoading ? "Thinking..." : "Ask"}
          </button>
        </div>
      )}
    </div>
  );
}