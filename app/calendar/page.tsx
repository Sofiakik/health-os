"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import libheif from "libheif-js";

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

type WhoopDay = {
  sleep_duration: number | null;
  recovery_score: number | null;
  hrv: number | null;
  resting_hr: number | null;
  strain: number | null;
  respiratory_rate?: number | null;
  skin_temperature?: number | null;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatSleep(hours: number | null) {
  if (!hours) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
}

export default function CalendarPage() {

  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(today());

  const [entries, setEntries] = useState<Entry[]>([]);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [dialogue, setDialogue] = useState<Dialogue[]>([]);
  const [whoop, setWhoop] = useState<WhoopDay | null>(null);

  const [noteType, setNoteType] = useState<NoteType>("meal");
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [question, setQuestion] = useState("");
  const [saving, setSaving] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  /* AUTH */

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

  /* LOAD DATA */

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

    const { data: whoopData, error } = await supabase
    .from("daily_health_summary")
    .select(`
      sleep_duration,
      recovery_score,
      hrv,
      resting_hr,
      strain,
      respiratory_rate,
      skin_temperature,
      created_at
    `)
    .eq("user_id", uid)
    .gte("date", date)
    .lt("date", date + "T23:59:59")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  
  console.log("WHOOP DB result:", whoopData);

  if (!whoopData && date === today()) {

    console.log("No WHOOP data for today. Triggering ingestion...");
  
    try {
  
      await fetch("/api/whoop/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: uid
        })
      });
  
      // reload after ingestion
      const { data: refreshed } = await supabase
        .from("daily_health_summary")
        .select(`
          sleep_duration,
          recovery_score,
          hrv,
          resting_hr,
          strain,
          respiratory_rate,
          skin_temperature
        `)
        .eq("user_id", uid)
        .gte("date", date)
        .lt("date", date + "T23:59:59")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  
      setWhoop(refreshed ?? null);
  
    } catch (e) {
  
      console.error("WHOOP sync failed", e);
  
    }
  
  } else {
  
    setWhoop(whoopData ?? null);
  
  }

    setWhoop(whoopData ?? null);

    setLoading(false);
  };

  useEffect(() => {
    if (!userId) return;
    loadDayData(userId, selectedDate);
  }, [userId, selectedDate]);

  /* IMAGE CONVERSION + COMPRESSION */

  async function convertIfHeic(file: File): Promise<File> {

    const isHeic =
      file.type.includes("heic") ||
      file.name.toLowerCase().endsWith(".heic") ||
      file.name.toLowerCase().endsWith(".heif");

    let canvas = document.createElement("canvas");
    let ctx = canvas.getContext("2d")!;

    if (isHeic) {

      const buffer = await file.arrayBuffer();
      const decoder = new libheif.HeifDecoder();
      const images = decoder.decode(buffer);

      if (!images.length) throw new Error("HEIC decode failed");

      const img = images[0];

      const width = img.get_width();
      const height = img.get_height();

      canvas.width = width;
      canvas.height = height;

      const imageData = ctx.createImageData(width, height);

      await new Promise<void>((resolve) => {

        img.display(imageData, (data: Uint8ClampedArray) => {

          imageData.data.set(data);
          resolve();

        });

      });

      ctx.putImageData(imageData, 0, 0);

    } else {

      const bitmap = await createImageBitmap(file);

      canvas.width = bitmap.width;
      canvas.height = bitmap.height;

      ctx.drawImage(bitmap, 0, 0);

    }

    /* resize if large */

    const MAX_WIDTH = 1600;

    if (canvas.width > MAX_WIDTH) {

      const scale = MAX_WIDTH / canvas.width;

      const resized = document.createElement("canvas");

      resized.width = canvas.width * scale;
      resized.height = canvas.height * scale;

      resized.getContext("2d")!.drawImage(
        canvas,
        0,
        0,
        resized.width,
        resized.height
      );

      canvas = resized;

    }

    /* compress progressively */

    let quality = 0.9;
    let blob: Blob | null = null;

    do {

      blob = await new Promise((resolve) =>
        canvas.toBlob(resolve as any, "image/jpeg", quality)
      );

      quality -= 0.1;

    } while (blob && blob.size > 450000 && quality > 0.3);

    return new File(
      [blob!],
      `${crypto.randomUUID()}.jpg`,
      { type: "image/jpeg" }
    );
  }

  /* UPLOAD */

  const uploadImage = async (uid: string, date: string) => {

    if (!file) return null;

    const processed = await convertIfHeic(file);

    const path = `${uid}/${date}/${processed.name}`;

    const { error } = await supabase.storage
      .from("entry-images")
      .upload(path, processed, {
        contentType: processed.type
      });

    if (error) throw error;

    return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/entry-images/${path}`;
  };

  /* SAVE ENTRY */

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

    } finally {

      setSaving(false);

    }
  };

  /* CHAT */

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

      setDialogue((d) => [
        ...d,
        { role: "assistant", message: data.reply }
      ]);

    } finally {

      setChatLoading(false);

    }
  };

  const signOut = async () => {

    await supabase.auth.signOut();
    router.replace("/login");

  };

  /* UI */

  return (
    <div style={{ maxWidth: 720, margin: "auto", padding: 24 }}>

      <div style={{ display: "flex", alignItems: "center" }}>
        <h2>Calendar</h2>
        <button onClick={signOut} style={{ marginLeft: "auto" }}>
          Sign out
        </button>
      </div>

      <input
        type="date"
        value={selectedDate}
        onChange={(e) => setSelectedDate(e.target.value)}
      />

      {/* WHOOP */}

      <div style={{ marginTop: 24 }}>

        <h3>WHOOP</h3>

        {!whoop ? (

          <p>No WHOOP data</p>

        ) : (

          <div>

            <div>Sleep: {formatSleep(whoop.sleep_duration)}</div>
            <div>Recovery: {whoop.recovery_score ?? "—"}</div>
            <div>HRV: {whoop.hrv ?? "—"}</div>
            <div>Resting HR: {whoop.resting_hr ?? "—"}</div>
            <div>Strain: {whoop.strain ?? "—"}</div>
            <div>Respiratory rate: {whoop.respiratory_rate ?? "—"}</div>
            <div>Skin temperature: {whoop.skin_temperature ?? "—"}</div>

          </div>

        )}

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
          style={{ width: "100%" }}
        />

        <input
          type="file"
          accept="image/*,.heic,.heif"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />

        <button onClick={saveEntry} disabled={saving}>
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

              <strong>
                {m.role === "assistant" ? "Assistant" : "You"}
              </strong>

              <p style={{ whiteSpace: "pre-wrap" }}>
                {m.message}
              </p>

            </div>

          ))}

          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about today's insight..."
            style={{ width: "100%" }}
          />

          <button
            onClick={sendQuestion}
            disabled={chatLoading}
          >
            {chatLoading ? "Thinking..." : "Ask"}
          </button>

        </div>

      )}

    </div>
  );
}