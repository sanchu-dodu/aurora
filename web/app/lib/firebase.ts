import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB9e3S7SsiG75IqcUpdN3jQnTYdRJ-lqHo",
  authDomain: "aurora-7b677.firebaseapp.com",
  projectId: "aurora-7b677",
  storageBucket: "aurora-7b677.firebasestorage.app",
  messagingSenderId: "590660779813",
  appId: "1:590660779813:web:f8b1474a4bc033b48724cc",
};

const app = !getApps().length
  ? initializeApp(firebaseConfig)
  : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;