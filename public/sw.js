// Network-first cache, as in CocoaCanvas. Hashed build assets (incl. the two
// .wasm modules) are cached on first use so the app works offline afterwards.
const C = "cocoacad-v2";
const A = ["./", "index.html", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(C).then((c) => c.addAll(A)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((k) => Promise.all(k.filter((x) => x !== C).map((x) => caches.delete(x))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    fetch(r)
      .then((res) => {
        if (res.ok) {
          const cp = res.clone();
          caches.open(C).then((c) => c.put(r, cp));
        }
        return res;
      })
      .catch(() => caches.match(r).then((m) => m || caches.match("index.html"))),
  );
});
