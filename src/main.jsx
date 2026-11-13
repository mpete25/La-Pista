import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import { initMonitoring, reportError } from "./lib/monitoring.js";

initMonitoring();
window.addEventListener("unhandledrejection", (e) => reportError(e.reason, { source: "unhandledrejection" }));

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Register the service worker in production builds only, so the dev server
// never serves stale files from the cache.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((err) => console.warn("Service worker registration failed:", err));
  });
}
