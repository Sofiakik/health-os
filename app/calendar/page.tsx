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

    const { data: whoopData } = await supabase
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
      .eq("date", date)
      .maybeSingle();

    setWhoop(whoopData ?? null);

    setLoading(false);

  };

  useEffect(() => {

    if (!userId) return;

    loadDayData(userId, selectedDate);

  }, [userId, selectedDate]);

  /*
  HEIC → JPG + compression (~400kb)
  */

  async function convertIfHeic(file: File): Promise<File> {

    const isHeic =
      file.type.includes("heic") ||
      file.name.toLowerCase().endsWith(".heic") ||
      file.name.toLowerCase().endsWith(".heif");

    let blob: Blob;

    if (isHeic) {

      const converted = await heic2any({
        blob: file,
        toType: "image/jpeg",
        quality: 0.9
      });

      blob = Array.isArray(converted) ? converted[0] : converted;

    } else {

      blob = file;

    }

    const img = await createImageBitmap(blob);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    const MAX_WIDTH = 1600;

    const scale = img.width > MAX_WIDTH
      ? MAX_WIDTH / img.width
      : 1;

    canvas.width = img.width * scale;
    canvas.height = img.height * scale;

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let quality = 0.9;
    let compressed: Blob | null = null;

    do {

      compressed = await new Promise(resolve =>
        canvas.toBlob(resolve as any, "image/jpeg", quality)
      );

      quality -= 0.1;

    } while (compressed && compressed.size > 400000 && quality > 0.3);

    return new File(
      [compressed!],
      `${crypto.randomUUID()}.jpg`,
      { type: "image/jpeg" }
    );

  }

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

  const sendQuestion = async () => {

    if (!question.trim() || !insight) return;

    const userMsg = { role: "user" as const, message: question };
    setDialogue(d => [...d, userMsg]);

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

      setDialogue(d => [
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