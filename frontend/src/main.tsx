import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const callbackParams = new URLSearchParams(window.location.search);
const powensCallback = Boolean(window.opener) && (
  callbackParams.has("connection_id") || callbackParams.has("connection_ids") || callbackParams.has("error")
);
if (powensCallback && window.opener) {
  window.opener.postMessage({ type: "comptaos:powens-callback", search: window.location.search }, window.location.origin);
  window.close();
}

// Nettoyage de l'ancien service worker Workbox retiré pour éviter de servir
// durablement des bundles ou réponses API obsolètes.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) =>
    Promise.all(registrations.map((registration) => registration.unregister())),
  );
}
if (!powensCallback || !window.opener) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
