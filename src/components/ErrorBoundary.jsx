import React from "react";
import { reportError } from "../lib/monitoring.js";
import { C, G, serif, sans } from "../theme.js";

/** Last line of defence: a render error shows a friendly page with a way
 *  back, instead of a blank screen, and is reported to monitoring. */
export default class ErrorBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    reportError(error, { componentStack: info?.componentStack });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" style={{ minHeight: "100vh", background: G.page, color: C.espresso, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", fontFamily: sans }}>
        <div style={{ maxWidth: 320 }}>
          <div style={{ fontFamily: serif, fontWeight: 700, fontSize: 24, marginBottom: 8 }}>Noget gik galt</div>
          <p style={{ color: C.muted, fontSize: 15, lineHeight: 1.5, margin: "0 0 22px" }}>
            Appen stødte på en fejl. Vi har fået besked. Prøv at genindlæse – dine point og tilmeldinger er gemt.
          </p>
          <button onClick={() => window.location.reload()} style={{ background: C.mokka, color: C.cream, border: 0, borderRadius: 999, padding: "12px 24px", fontSize: 15, fontWeight: 600, fontFamily: sans, cursor: "pointer" }}>
            Genindlæs
          </button>
        </div>
      </div>
    );
  }
}
