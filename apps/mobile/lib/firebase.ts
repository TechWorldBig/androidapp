import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const app = initializeApp({
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || 'AIzaSyBcxRQIuMdBinZe2S2GRYtpUEj7h0oLoKU',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || 'jsc-bible-quiz.firebaseapp.com',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || 'jsc-bible-quiz',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '1:323325289419:web:1f430256a3d853a9cb4c4e',
});
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
