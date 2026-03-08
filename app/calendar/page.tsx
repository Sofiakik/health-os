"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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

type Insight = {
  id: string;
  insight: {
    text: string;
    start_date?: string;
    end_date?: string;
  };
};

const BUCKET = "entry-images";

function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function SignedImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 3600);

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
  const [insight, setInsight] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(true);

  const [noteType, setNoteType] = useState<NoteType>("meal");
  const [mealType, setMealType] = useState<MealType>("breakfast");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [question, setQuestion] = useState("");
  const [chatReply, setChatReply] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);

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

  const fetchEntries = async (uid: string, date: string) => {

    setLoading(true);

    const { data } = await supabase
      .from("entries")
      .select("*")
      .eq("user_id", uid)
      .eq("date", date)
      .order("created_at", { ascending: false });

    setEntries((data ?? []) as Entry[]);

    const { data: insightData } = await supabase
      .from("daily_insights")
      .select("*")
      .eq("user_id", uid)
      .eq("date", date)
      .maybeSingle();

    setInsight(insightData ?? null);

    setLoading(false);
  };

  useEffect(() => {
    if (!userId) return;
    fetchEntries(userId, selectedDate);
  }, [userId, selectedDate]);

  async function convertHeicIfNeeded(file: File): Promise<File> {

    const name = file.name.toLowerCase();

    const isHeic =
      name.endsWith(".heic") ||
      name.endsWith(".heif") ||
      file.type.includes("heic");

    if (!isHeic) return file;

    const heic2any = (await import("heic2any")).default;

    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.92,
    });

    const blob = Array.isArray(converted) ? converted[0] : converted;

    return new File(
      [blob as Blob],
      file.name.replace(/\.(heic|heif)$/i, ".jpg"),
      { type: "image/jpeg" }
    );
  }

  const uploadIfAny = async (uid: string, date: string) => {

    if (!file) return null;

    const uploadFile = await convertHeicIfNeeded(file);

    const ext =
      uploadFile.name.split(".").pop()?.toLowerCase() || "jpg";

    const path = `${uid}/${date}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, uploadFile);

    if (error) throw error;

    return path;
  };

  const saveEntry = async () => {

    if (!userId) return;

    const hasText = note.trim().length > 0;
    const hasImage = !!file;

    if (!hasText && !hasImage) return;

    setSaving(true);

    try {

      const imagePath = await uploadIfAny(userId, selectedDate);

      const payload = {
        user_id: userId,
        date: selectedDate,
        note: hasText ? note.trim() : null,
        note_type: noteType,
        meal_type: noteType === "meal" ? mealType : null,
        image_url: imagePath,
      };

      const { error } = await supabase.from("entries").insert(payload);

      if (error) throw error;

      setNote("");
      setFile(null);

      await fetchEntries(userId, selectedDate);

    } catch (e: any) {

      setError(e.message);

    } finally {

      setSaving(false);

    }
  };

  const sendQuestion = async () => {

    if (!question.trim() || !insight) return;

    setChatLoading(true);

    try {

      const res = await fetch("/api/insights/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          user_id: userId,
          insight_id: insight.id,
          message: question
        })
      });

      const data = await res.json();

      setChatReply(data.reply);

      setQuestion("");

    } catch (e) {

      console.error(e);

    } finally {

      setChatLoading(false);

    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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

      {insight && (
        <div style={{
          marginTop: 20,
          padding: 16,
          border: "1px solid #eee",
          borderRadius: 8,
          background: "#fafafa"
        }}>
          <h3>Daily Insight</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>
            {insight.insight?.text}
          </p>
        </div>
      )}

      {insight && (

        <div style={{
          marginTop: 16,
          padding: 16,
          border: "1px solid #eee",
          borderRadius: 8
        }}>

          <h3>Ask about today's insight</h3>

          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            style={{
              width: "100%",
              marginTop: 8,
              minHeight: 60
            }}
          />

          <button
            onClick={sendQuestion}
            disabled={chatLoading}
            style={{ marginTop: 10 }}
          >
            {chatLoading ? "Thinking..." : "Ask"}
          </button>

          {chatReply && (
            <div style={{
              marginTop: 12,
              padding: 12,
              background: "#f5f5f5",
              borderRadius: 6
            }}>
              <strong>Assistant</strong>
              <p style={{ whiteSpace: "pre-wrap" }}>
                {chatReply}
              </p>
            </div>
          )}

        </div>

      )}

      <textarea
        ref={textareaRef}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{ width: "100%", marginTop: 16 }}
      />

      <div style={{ marginTop: 10 }}>
        <input
          type="file"
          accept="image/*"
          onChange={(e) =>
            setFile(e.target.files?.[0] ?? null)
          }
        />
      </div>

      <button
        onClick={saveEntry}
        disabled={saving}
        style={{ marginTop: 12 }}
      >
        {saving ? "Saving…" : "Save"}
      </button>

      {error && (
        <p style={{ color: "red", marginTop: 10 }}>{error}</p>
      )}

      <h3 style={{ marginTop: 24 }}>
        Entries for {selectedDate}
      </h3>

      {loading ? (
        <p>Loading…</p>
      ) : entries.length === 0 ? (
        <p>No entries yet.</p>
      ) : (
        entries.map((e) => (
          <div
            key={e.id}
            style={{
              border: "1px solid #eee",
              borderRadius: 8,
              padding: 12,
              marginTop: 10,
            }}
          >

            {e.note && (
              <p style={{ whiteSpace: "pre-wrap" }}>
                {e.note}
              </p>
            )}

            {e.image_url && (
              <SignedImage path={e.image_url} />
            )}

          </div>
        ))
      )}

    </div>
  );
}