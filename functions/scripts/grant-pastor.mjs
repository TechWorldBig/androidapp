import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const [email] = process.argv.slice(2);
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (!email) {
  throw new Error('Usage: node scripts/grant-pastor.mjs pastor@example.com');
}

if (!serviceAccount) {
  throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON to the downloaded Firebase service-account JSON before running this script.');
}

if (getApps().length === 0) {
  initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
}

const user = await getAuth().getUserByEmail(email.trim());
await getAuth().setCustomUserClaims(user.uid, { pastor: true });
console.log(`Pastor role granted to ${user.email}. Sign out and sign in again before opening the dashboard.`);
