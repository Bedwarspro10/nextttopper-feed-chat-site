import { useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import { CheckCircle2, Copy, MessageCircle, X } from "lucide-react";
import { db } from "./firebase";
import Chat from "./Chat";

const STORAGE_KEY = "nt_chat_verified_uid";

export default function App() {
  const [uid, setUid] = useState("");
  const [verifiedUid, setVerifiedUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [showUid, setShowUid] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setVerifiedUid(saved);
    setLoading(false);
  }, []);

  async function verify() {
    const value = uid.trim();
    setError("");

    if (!value) {
      setError("Please enter your Firebase UID.");
      return;
    }

    setVerifying(true);
    try {
      // UID is used as the existing user's identifier. We only accept
      // a UID that exists in the existing users collection.
      const userDoc = await getDoc(doc(db, "users", value));

      if (userDoc.exists()) {
        localStorage.setItem(STORAGE_KEY, value);
        setVerifiedUid(value);
        setShowUid(true);
        return;
      }

      // Fallback: some existing projects may not have users/{uid} documents
      // but may have a uid field. Keep lookup read-only.
      const q = query(
        collection(db, "users"),
        where("uid", "==", value),
        limit(1)
      );
      const snap = await getDocs(q);

      if (!snap.empty) {
        localStorage.setItem(STORAGE_KEY, value);
        setVerifiedUid(value);
        setShowUid(true);
      } else {
        setError("UID not found. Please check the UID and try again.");
      }
    } catch (e: any) {
      setError(e?.message || "Unable to verify UID.");
    } finally {
      setVerifying(false);
    }
  }

  function clearSavedUid() {
    localStorage.removeItem(STORAGE_KEY);
    setVerifiedUid(null);
    setUid("");
    setShowUid(true);
  }

  if (loading) {
    return <div className="screen-center"><div className="loader" /></div>;
  }

  if (!verifiedUid) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand-mark"><MessageCircle size={25} /></div>
          <h1>Next Toppers Chat</h1>
          <p>Enter your Firebase UID to verify your account and open your chats.</p>

          <input
            className="uid-input"
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") verify(); }}
            placeholder="Enter your Firebase UID"
            autoComplete="off"
            spellCheck={false}
          />

          {error && <div className="error-box">{error}</div>}

          <button className="primary-btn" onClick={verify} disabled={verifying}>
            <CheckCircle2 size={18} />
            {verifying ? "Verifying…" : "Verify & Open Chat"}
          </button>

          <small>Your UID is used to find your existing Next Toppers account and chats.</small>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {showUid && (
        <header className="identity-bar">
          <div className="identity-content">
            <div className="identity-title">Your Firebase UID</div>
            <div className="identity-uid">{verifiedUid}</div>
          </div>
          <div className="identity-actions">
            <button
              className="icon-btn"
              title="Copy UID"
              onClick={() => navigator.clipboard?.writeText(verifiedUid)}
            >
              <Copy size={18} />
            </button>
            <button
              className="icon-btn"
              title="Hide UID"
              onClick={() => setShowUid(false)}
            >
              <X size={18} />
            </button>
          </div>
        </header>
      )}

      {!showUid && (
        <header className="identity-bar compact-bar">
          <div className="identity-content">
            <div className="identity-title">Next Toppers Chat</div>
            <div className="identity-subtitle">UID verified</div>
          </div>
          <button className="icon-btn" onClick={() => setShowUid(true)}>
            <MessageCircle size={18} />
          </button>
        </header>
      )}

      <Chat currentUid={verifiedUid} />
    </div>
  );
}
