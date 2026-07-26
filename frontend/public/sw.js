// Service worker de retrait : remplace l'ancien Workbox, vide ses caches puis
// se désinscrit afin que les prochains chargements utilisent toujours le réseau.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name)))),
      self.registration.unregister(),
    ]).then(() => self.clients.claim()),
  );
});
