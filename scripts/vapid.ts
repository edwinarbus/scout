/**
 * Generate a VAPID keypair for Web Push. Run once, paste the output into
 * .env.local, restart the dev server, and Scout can send PWA notifications.
 *
 *   npm run scout:vapid
 */
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
Add these to .env.local (keep the private key secret):

SCOUT_VAPID_PUBLIC_KEY=${publicKey}
SCOUT_VAPID_PRIVATE_KEY=${privateKey}
SCOUT_VAPID_SUBJECT=mailto:you@example.com
`);
