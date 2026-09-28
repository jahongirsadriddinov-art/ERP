import { Component, ReactNode } from "react";
import { reportError } from "./lib/monitoring";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    // Eski kod mavjud bo'lmagan VITE_API_BASE'ga qarardi — umumiy reporter (to'g'ri manzil, versiya, platforma)
    reportError(error.message, error.stack, { componentStack: info.componentStack?.slice(0, 2000), kind: "react" });
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
