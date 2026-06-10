import { initializeApp } from "firebase/app";
import {
  getAuth,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

let confirmationResult = null;

/**
 * Sends an OTP SMS to the given phone number.
 * Must be called with a DOM element id to anchor the invisible reCAPTCHA.
 */
export async function sendOtp(phoneNumber, recaptchaContainerId) {
  // Normalise Israeli numbers: 05x → +9725x
  const e164 = normalisePhone(phoneNumber);
  console.log("[Firebase] Sending OTP to:", e164);

  // Tear down any previous verifier so we can re-send cleanly
  if (window._recaptchaVerifier) {
    try { window._recaptchaVerifier.clear(); } catch {}
    window._recaptchaVerifier = null;
  }

  try {
    window._recaptchaVerifier = new RecaptchaVerifier(auth, recaptchaContainerId, {
      size: "invisible",
    });
    console.log("[Firebase] RecaptchaVerifier created");

    confirmationResult = await signInWithPhoneNumber(
      auth,
      e164,
      window._recaptchaVerifier,
    );
    console.log("[Firebase] signInWithPhoneNumber succeeded, confirmationResult:", confirmationResult);
  } catch (err) {
    console.error("[Firebase] sendOtp error:", err.code, err.message, err);
    throw err;
  }
}

/**
 * Verifies the 6-digit OTP the user typed.
 * Returns the Firebase user on success, throws on failure.
 */
export async function verifyOtp(code) {
  if (!confirmationResult) {
    throw new Error("לא נשלח קוד — יש לשלוח קוד תחילה");
  }
  const result = await confirmationResult.confirm(code);
  return result.user;
}

/**
 * Converts 05xxxxxxxx → +9725xxxxxxxx
 * Leaves numbers that already start with + untouched.
 */
function normalisePhone(raw) {
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return raw;
  if (digits.startsWith("05")) return `+972${digits.slice(1)}`;
  if (digits.startsWith("972")) return `+${digits}`;
  return `+972${digits}`;
}
