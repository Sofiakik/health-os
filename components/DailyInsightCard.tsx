"use client";
import { ReactNode } from "react";

type InsightCardData = {
  insight_text: string | null;
  hypothesis: string | null;
  confidence: number | null;
};

type DailyInsightCardProps = {
  loading: boolean;
  hasMealsToday: boolean;
  insight: InsightCardData | null;
};

function formatConfidence(confidence: number | null): string {
  if (confidence == null) return "—";
  return `${Math.round(Number(confidence) * 100)}%`;
}

export default function DailyInsightCard({
  loading,
  hasMealsToday,
  insight,
}: DailyInsightCardProps) {
  let content: ReactNode;

  if (loading) {
    content = <p style={{ margin: 0 }}>Loading daily insight...</p>;
  } else if (!hasMealsToday) {
    content = <p style={{ margin: 0 }}>No meal+WHOOP insights today</p>;
  } else if (!insight) {
    content = <p style={{ margin: 0 }}>Insight is being generated</p>;
  } else {
    content = (
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 16, whiteSpace: "pre-wrap" }}>
          {insight.insight_text ?? "No insight text available."}
        </div>
        <div style={{ fontSize: 14, opacity: 0.8, whiteSpace: "pre-wrap" }}>
          {insight.hypothesis ?? "No hypothesis available."}
        </div>
        <div style={{ fontSize: 13, opacity: 0.7 }}>
          Confidence: {formatConfidence(insight.confidence)}
        </div>
      </div>
    );
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h3>Daily insight</h3>
      <div
        style={{
          marginTop: 10,
          border: "1px solid #ddd",
          borderRadius: 10,
          padding: 14,
          background: "#fff",
        }}
      >
        {content}
      </div>
    </section>
  );
}
