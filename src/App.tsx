import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithCustomToken, User } from "firebase/auth";
import { MessageCircle, WifiOff } from "lucide-react";
import { auth, authPersistenceReady } from "./firebase";
import Chat from "./Chat";

const AUTH_TIMEOUT_MS = 20_000;

declare global {
  interface Window {
    /**
     * Android calls this after the Chat WebView is loaded.
     *
     * The argument must be the short-lived Firebase ID token belonging
     * to the currently signed-in Android Firebase user.
     *
     * The token is exchanged server-side for a Firebase custom token;
     * it is never treated as a UID and is never stored in localStorage.
     */
    __NT_SET_FIREBASE_ID_TOKEN__?: (idToken: string) => void;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [handoffStarted, setHandoffStarted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!active) return;
      setUser(firebaseUser);
      setAuthReady(true);
      if (firebaseUser) setError("");
    });

    // Android calls this function through WebView.evaluateJavascript().
    // Do not pass a UID. Pass the Firebase ID token.
    window.__NT_SET_FIREBASE_ID_TOKEN__ = async (idToken: string) => {
      if (!idToken || typeof idToken !== "string") {
        setError("Invalid authentication handoff.");
        return;
      }

      setHandoffStarted(true);
      setError("");

      try {
        await authPersistenceReady;

        const response = await fetch("/api/auth/exchange", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ idToken }),
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.customToken) {
          throw new Error(result.error || "Unable to authenticate this device.");
        }

        await signInWithCustomToken(auth, result.customToken);
      } catch (e: any) {
        console.error("Chat authentication handoff failed:", e);
        setError(e?.message || "Unable to authenticate. Please reopen Chat.");
      } finally {
        setHandoffStarted(false);
      }
    };

    return () => {
      active = false;
      unsubscribe();
      delete window.__NT_SET_FIREBASE_ID_TOKEN__;
    };
  }, []);

  // If the WebView already has a valid Firebase web session, this will
  // resolve without requiring Android to send another token.
  if (!authReady) {
    return <LoadingScreen text="Connecting to Chat…" />;
  }

  if (user) {
    return <Chat currentUid={user.uid} />;
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand-mark">
          {error ? <WifiOff size={25} /> : <MessageCircle size={25} />}
        </div>

        <h1>{error ? "Chat connection failed" : "Connecting your account"}</h1>

        <p>
          {error
            ? error
            : handoffStarted
              ? "Verifying your Firebase account…"
              : "Waiting for the signed-in Next Toppers account…"}
        </p>

        {!error && (
          <div className="handoff-loader">
            <div className="loader" />
          </div>
        )}

        {error && (
          <button
            className="primary-btn"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        )}

        <small>
          Your Firebase UID is obtained from the authenticated Firebase
          session. It is never used as a password or as standalone proof of identity.
        </small>
      </div>
    </div>
  );
}

function LoadingScreen({ text }: { text: string }) {
  return (
    <div className="screen-center">
      <div className="loading-stack">
        <div className="loader" />
        <span>{text}</span>
      </div>
    </div>
  );
}
