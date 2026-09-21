import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
const EcosystemPrototype = React.lazy(() => import("./components/Ecosystem/EcosystemPrototype"));
const prototype = new URLSearchParams(window.location.search).get("prototype") === "ecosystem";
import "./index.css";

// Nettoyage de l'ancien service worker Workbox retiré pour éviter de servir
// durablement des bundles ou réponses API obsolètes.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) =>
    Promise.all(registrations.map((registration) => registration.unregister())),
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {prototype ? <React.Suspense fallback={<p>Chargement du prototype…</p>}><EcosystemPrototype /></React.Suspense> : <App />}
  </React.StrictMode>
);
