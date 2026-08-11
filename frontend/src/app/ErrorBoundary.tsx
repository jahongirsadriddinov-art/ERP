import { Component, ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE || "https://qurilisherp-backend.onrender.com";
      fetch(`${API_BASE}/api/errors/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack,
          url: window.location.href,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
        }),
      }).catch(() => {});
    } catch {}
  }

  render() {
    if (this.state.error) {
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
