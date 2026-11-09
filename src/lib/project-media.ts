// Device-local media backup survives the server's temporary-file retention.
function openMedia(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lyrica-media-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("media");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function mediaStore(url: string, blob?: Blob): Promise<Blob | undefined> {
  const db = await openMedia();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("media", blob ? "readwrite" : "readonly");
      const store = tx.objectStore("media");
      const request = blob ? store.put(blob, url) : store.get(url);
      tx.oncomplete = () => resolve(blob ?? (request.result instanceof Blob ? request.result : undefined));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function backupMedia(url: string): Promise<void> {
  if (!url.startsWith("/api/audio/") || await mediaStore(url)) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Mediensicherung fehlgeschlagen.");
  await mediaStore(url, await response.blob());
}

export async function restoreMedia(url: string, kind: "audio" | "bg" | "logo"): Promise<string> {
  if (!url.startsWith("/api/audio/")) return url;
  const response = await fetch(url, { method: "HEAD", cache: "no-store" });
  if (response.ok) return url;
  if (response.status !== 404) throw new Error("Medien sind momentan nicht erreichbar.");
  const blob = await mediaStore(url);
  if (!blob) throw new Error("Originalmedium fehlt. Bitte dieselbe Datei erneut verknüpfen.");
  const name = new URL(url, location.origin).pathname.split("/").pop() ?? "media";
  const body = new FormData();
  body.append(kind === "bg" ? "image" : kind, blob, name);
  const upload = await fetch(`/api/upload-${kind}`, { method: "POST", body });
  if (!upload.ok) throw new Error("Medium konnte nicht wiederhergestellt werden.");
  const data = await upload.json();
  const filename = kind === "audio" ? data.audioFilename : data.filename;
  if (typeof filename !== "string" || !/^[\w.-]+$/.test(filename)) throw new Error("Ungültige Medienantwort.");
  const restored = `/api/audio/${filename}`;
  await mediaStore(restored, blob);
  return restored;
}
