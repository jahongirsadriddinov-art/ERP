import { Component, ReactNode } from "react";
import { reportError } from "./lib/monitoring";
import { isChunkError, reloadForNewVersion } from "./lib/chunkReload";
import { reloadWhenVisible } from "./lib/lazyRetry";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Yangi versiya chiqqan, eski bo'lak topilmadi — xato emas: jimgina yangilaymiz
    // Fonda (Telegram Mini App kichraytirilgan, telefon qulflangan) — ko'rinadigan bo'lgach yangilanadi:
    // yashirin sahifani qayta yuklash iOS'da qaytganda oq ekran qoldirardi
    if (isChunkError(error)) {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") { reloadWhenVisible(); return; }
      if (reloadForNewVersion()) return;
    }
    console.error("[ErrorBoundary]", error, info.componentStack);
    // Eski kod mavjud bo'lmagan VITE_API_BASE'ga qarardi — umumiy reporter (to'g'ri manzil, versiya, platforma)
    reportError(error.message, error.stack, { componentStack: info.componentStack?.slice(0, 2000), kind: "react" });
  }

  render() {
    if (this.state.error) {
      if (isChunkError(this.state.error)) {
        return (
          <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem",
            background: "var(--background, #f8fafc)", color: "var(--foreground, #0f172a)", fontFamily: "system-ui, sans-serif", padding: "2rem", textAlign: "center" }}>
            <p style={{ fontSize: "1rem", fontWeight: 700 }}>Yangi versiya chiqdi</p>
            <p style={{ fontSize: "0.875rem", opacity: 0.7, maxWidth: 360 }}>Davom etish uchun sahifani yangilang.</p>
            <button onClick={() => window.location.reload()}
              style={{ background: "var(--primary, #4f46e5)", color: "#fff", border: "none", borderRadius: "0.9rem", padding: "0.7rem 1.6rem", fontSize: "0.9rem", fontWeight: 700, cursor: "pointer" }}>
              Yangilash
            </button>
          </div>
        );
      }
      return (
        <div style={{
          minHeight: "100vh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          background: "#090F1C", color: "#E8EEF9", fontFamily: "system-ui, sans-serif",
          padding: "2rem", textAlign: "center",
        }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            Kutilmagan xatolik
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#7A90B0", marginBottom: "1.5rem", maxWidth: 400 }}>
            {this.state.error.message || "Sahifani yuklashda xatolik yuz berdi"}
          </p>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{
              background: "#1B3A6B", color: "#fff", border: "none",
              borderRadius: "0.75rem", padding: "0.625rem 1.5rem",
              fontSize: "0.875rem", fontWeight: 600, cursor: "pointer",
            }}
          >
            Qayta yuklash
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
