import { ImageResponse } from "next/og";

// The preview card shown when the demo link is pasted into email, Slack or chat.
export const alt = "Room Booking Assistant: chat to check availability, get an exact quote and book a room";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#2b2622";
const PAPER = "#f7f4ef";
const ACCENT = "#8a6d4b";
const MUTED = "#6b6257";
const LINE = "#e8e1d6";
const OK = "#3f7a52";

function Arch({ size: s, color }: { size: number; color: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none">
      <path d="M17 50V29.5a15 15 0 0 1 30 0V50" stroke={color} strokeWidth="4.2" strokeLinecap="round" />
      <path d="M26.5 50V35a5.5 5.5 0 0 1 11 0v15" stroke={color} strokeWidth="4.2" strokeLinecap="round" />
    </svg>
  );
}

export default function OpenGraphImage() {
  const row = (label: string, value: string, strong = false) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "14px 0",
        borderTop: `1px solid ${LINE}`,
        fontSize: strong ? 34 : 24,
        fontWeight: strong ? 700 : 400,
        color: strong ? INK : MUTED,
      }}
    >
      <span>{label}</span>
      <span style={{ color: INK }}>{value}</span>
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: PAPER,
          padding: 72,
          gap: 56,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div
              style={{
                display: "flex",
                width: 72,
                height: 72,
                borderRadius: 18,
                background: INK,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Arch size={52} color={PAPER} />
            </div>
            <span style={{ fontSize: 22, letterSpacing: 5, color: ACCENT, fontWeight: 700 }}>
              EASTERN ESSENCE STUDIO
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <span style={{ fontSize: 76, fontWeight: 700, color: INK, lineHeight: 1.05 }}>Room Booking Assistant</span>
            <span style={{ fontSize: 30, color: MUTED, lineHeight: 1.4 }}>
              Chat to check Room A and Room B, get an exact quote, and receive your confirmation by email.
            </span>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            {["$100 per hour", "15% off 4+ hours", "Email confirmation"].map((t) => (
              <span
                key={t}
                style={{
                  display: "flex",
                  whiteSpace: "nowrap",
                  fontSize: 21,
                  padding: "10px 20px",
                  borderRadius: 999,
                  border: `2px solid ${LINE}`,
                  background: "white",
                  color: INK,
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* A sample quote, styled like the app's booking ticket */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 380,
            alignSelf: "center",
            background: "white",
            borderRadius: 28,
            border: `2px solid ${LINE}`,
            padding: 32,
            boxShadow: "0 30px 60px -30px rgba(43,38,34,0.35)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 28, fontWeight: 700, color: INK }}>Your quote</span>
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: OK,
                border: `3px solid ${OK}`,
                borderRadius: 8,
                padding: "2px 10px",
                letterSpacing: 3,
                transform: "rotate(-8deg)",
              }}
            >
              BOOKED
            </span>
          </div>
          {row("Room", "Room B")}
          {row("Duration", "4 hours")}
          {row("Discount", "−15%")}
          {row("Total", "$340.00", true)}
        </div>
      </div>
    ),
    size,
  );
}
