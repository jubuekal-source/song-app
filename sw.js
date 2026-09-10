/* ============================================================
   Song-App — Service Worker (spec/16)

   Aufgabe: die App startet auch ohne Netz.

   Diese Datei ist die EINZIGE Ausnahme von der Single-File-Regel aus spec/00.
   index.html laeuft ohne sie vollstaendig — fehlt sie, fehlt nur die Offline-Garantie.

   Drei Regeln, die hier nie gebrochen werden (spec/16 §1, §3.5):
     1. Kein Zugriff auf Songdaten. Kein localStorage, kein indexedDB, kein DATA.
     2. Nur eigene Dateien im Cache. Nie eine fremde Domain.
     3. Nichts verlaesst das Geraet. Kein Push, kein Sync, kein Tracking.
   ============================================================ */

/* spec/16 §2 — Die Version kommt aus der eigenen URL (sw.js?v=1.0.0).
   Einzige Quelle ist APP_VERSION in index.html; hier steht bewusst KEINE zweite Zahl,
   die auseinanderlaufen koennte. */
const VERSION = new URL(self.location.href).searchParams.get('v') || '0';

/* spec/16 §3.1 — Jede App-Version bekommt ihren eigenen Cache. */
const CACHE_PREFIX = 'song-app-v';
const CACHE_NAME = CACHE_PREFIX + VERSION;

/* spec/16 §3.2 — Beide Schreibweisen derselben Seite: GitHub Pages liefert die App sowohl
   unter …/song-app/ als auch unter …/song-app/index.html aus, und das sind zwei
   verschiedene Cache-Schluessel. */
const PRECACHE = ['./', './index.html'];

/* ---------- install ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE);
    } catch (e) {
      /* spec/16 §3.2 — Kein Netz genau im Installationsmoment darf die Installation nicht
         scheitern lassen. Ein leerer Cache fuellt sich beim naechsten erfolgreichen
         Aufruf ueber die fetch-Strategie von selbst. */
    }
    await self.skipWaiting();
  })());
});

/* ---------- activate ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    /* spec/16 §3.3 — Alle eigenen Caches anderer Versionen loeschen.
       Fremde Caches bleiben unangetastet. */
    const namen = await caches.keys();
    await Promise.all(
      namen
        .filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

/* ---------- fetch: stale-while-revalidate (spec/16 §3.4) ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  /* Nur eigene GET-Anfragen. Alles andere — fremde Domains, POST, Range-Requests —
     bleibt unangetastet: ohne respondWith() laeuft die Anfrage normal ans Netz.
     Das ist die technische Umsetzung von "nie eine fremde Domain cachen". */
  if (req.method !== 'GET') return;
  let ziel;
  try {
    ziel = new URL(req.url);
  } catch (e) {
    return;
  }
  if (ziel.origin !== self.location.origin) return;

  /* spec/16 §4 — Die Versionsabfrage der App muss am Cache vorbei ans Netz, sonst
     bekaeme sie die Fassung zu sehen, die sie ohnehin schon ausfuehrt. Sie wird
     bewusst nicht abgefangen und landet auch nicht im Cache. */
  if (ziel.searchParams.has('vcheck')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: false });

    /* Im Hintergrund die Netzfassung holen und fuer den naechsten Start hinterlegen.
       Bewusst NICHT awaited, wenn schon etwas im Cache liegt — genau das ist der Punkt
       von stale-while-revalidate: offline entsteht hier keine Wartezeit. */
    const netz = fetch(req).then((res) => {
      if (res && res.ok && res.type !== 'opaque') {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    }).catch(() => null);

    if (cached) {
      event.waitUntil(netz);
      return cached;
    }

    const frisch = await netz;
    if (frisch) return frisch;

    /* Weder Cache noch Netz. Fuer einen Seitenaufruf ist die gecachte Startseite
       immer noch besser als die Offline-Fehlerseite des Browsers. */
    if (req.mode === 'navigate') {
      const start = await cache.match('./index.html') || await cache.match('./');
      if (start) return start;
    }
    return Response.error();
  })());
});

/* ---------- Nachricht aus der App ---------- */
self.addEventListener('message', (event) => {
  /* Erlaubt der App, ein wartendes Update sofort zu aktivieren (spec/16 §4). */
  if (event.data && event.data.typ === 'skipWaiting') self.skipWaiting();
});
