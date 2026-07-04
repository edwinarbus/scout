/**
 * Browser-side Web Push helpers for the PWA: register the service worker,
 * subscribe/unsubscribe the current device, and report status. The server
 * side lives in src/lib/push.ts (fan-out) and /api/push (config + storage).
 *
 * Everything degrades quietly: on a browser without service workers or the
 * Push API, isPushSupported() is false and the UI hides the toggle.
 */

const SW_URL = "/sw.js";

export interface PushConfig {
  enabled: boolean; // server has VAPID keys
  publicKey: string;
}

/** True when this browser can do service-worker Web Push at all. */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** VAPID keys arrive base64url; the subscribe call wants an ArrayBuffer-backed
 *  view (an explicit ArrayBuffer, not the ArrayBufferLike a bare `new
 *  Uint8Array(len)` infers, which `applicationServerKey` rejects). */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Register the service worker (idempotent) and return its registration. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL);
  } catch {
    return null;
  }
}

/** Ask the server whether push is configured + for the VAPID public key. */
export async function fetchPushConfig(): Promise<PushConfig> {
  try {
    const res = await fetch("/api/push");
    const data = await res.json();
    return { enabled: !!data.enabled, publicKey: data.publicKey ?? "" };
  } catch {
    return { enabled: false, publicKey: "" };
  }
}

/** Whether THIS browser currently holds a push subscription. */
export async function isSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

/**
 * Request permission (if needed), subscribe this device, and store the
 * subscription server-side. Returns a status the UI can message from.
 */
export async function enablePush(publicKey: string): Promise<"ok" | "denied" | "error"> {
  if (!isPushSupported() || !publicKey) return "error";
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";

    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
    if (!reg) return "error";
    await navigator.serviceWorker.ready;

    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    const res = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

/** Unsubscribe this device and forget it server-side. */
export async function disablePush(): Promise<"ok" | "error"> {
  if (!isPushSupported()) return "error";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    return "ok";
  } catch {
    return "error";
  }
}
