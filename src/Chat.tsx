import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  AtSign,
  Check,
  CheckCheck,
  ChevronLeft,
  Copy,
  Reply,
  Search,
  Send,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { db } from "./firebase";

/* ============================================================
   Types — mirror the existing Firestore contract exactly.
   Collections / fields are unchanged:
     communityMessages
     privateChatMeta
     privateChats/{chatId}/messages
     users/{uid}
   ============================================================ */
type Msg = {
  id: string;
  text?: string;
  message?: string;
  senderId: string;
  senderName?: string;
  senderPhoto?: string | null;
  createdAt?: any;
  replyTo?: { id: string; text: string; senderName: string } | null;
  deleted?: boolean;
  deletedBy?: string;
  seenBy?: string[];
};

type Person = {
  uid: string;
  displayName: string;
  photoURL: string | null;
  online?: boolean;
  email?: string | null;
};

type Convo = {
  id: string;
  participants: string[];
  other: Person;
  lastMessage: string;
  lastMessageAt?: any;
  unread: number;
};

/* ------------------------- helpers ------------------------- */
const textOf = (m: Msg) => m.text ?? m.message ?? "";

const timeOf = (v: any) => {
  if (!v) return "";
  const d = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const dayOf = (v: any) => {
  if (!v) return "";
  const d = v?.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
};

// Private conversation id = sorted uid pair joined with "_" (existing schema).
const conversationId = (a: string, b: string) => [a, b].sort().join("_");

/* ============================================================
   Root component
   ============================================================ */
export default function Chat({ currentUid }: { currentUid: string }) {
  const [mode, setMode] = useState<"community" | "private">("community");
  const [community, setCommunity] = useState<Msg[]>([]);
  const [convos, setConvos] = useState<Convo[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [privateMsgs, setPrivateMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [reply, setReply] = useState<Msg | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState("");
  const [showPeople, setShowPeople] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* -------- keep the viewport height in sync inside the
     Android WebView so the keyboard never mis-positions the
     composer (visualViewport is more reliable than 100dvh on
     some WebView builds). Presentation-only; no auth impact. */
  useEffect(() => {
    const root = document.documentElement;
    const setVh = () => {
      const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      root.style.setProperty("--app-vh", `${h}px`);
    };
    setVh();
    window.visualViewport?.addEventListener("resize", setVh);
    window.addEventListener("resize", setVh);
    return () => {
      window.visualViewport?.removeEventListener("resize", setVh);
      window.removeEventListener("resize", setVh);
    };
  }, []);

  /* -------- community messages (single shared listener) -------- */
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "communityMessages"), orderBy("createdAt", "asc"), limit(500)),
        (snap) =>
          setCommunity(
            snap.docs.map((d) => {
              const data = d.data() as any;
              return { id: d.id, ...data, text: data.text ?? data.message ?? "" } as Msg;
            })
          ),
        (e) => setError(e.message)
      ),
    []
  );

  /* -------- private conversation list for this user -------- */
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "privateChatMeta"), where("participants", "array-contains", currentUid)),
        async (snap) => {
          const out: Convo[] = [];
          for (const d of snap.docs) {
            const x = d.data() as any;
            const otherUid = (x.participants || []).find((p: string) => p !== currentUid);
            if (!otherUid) continue;

            let other: Person = { uid: otherUid, displayName: "Student", photoURL: null };
            try {
              const u = await getDoc(doc(db, "users", otherUid));
              if (u.exists()) {
                const z = u.data() as any;
                other = {
                  uid: otherUid,
                  displayName: z.name || z.displayName || "Student",
                  photoURL: z.photoURL || null,
                  online: z.isOnline ?? z.online ?? false,
                  email: z.email ?? null,
                };
              }
            } catch {
              /* keep fallback profile */
            }

            out.push({
              id: d.id,
              participants: x.participants,
              other,
              lastMessage: x.lastMessage || "",
              lastMessageAt: x.lastMessageAt || null,
              unread: Number(x[`unread_${currentUid}`] || 0),
            });
          }
          out.sort((a, b) => (b.lastMessageAt?.toMillis?.() ?? 0) - (a.lastMessageAt?.toMillis?.() ?? 0));
          setConvos(out);
        },
        (e) => setError(e.message)
      ),
    [currentUid]
  );

  /* -------- messages for the active private conversation --------
     Listener is created only while a conversation is open, and is
     torn down (via the effect cleanup) the moment it changes or the
     user leaves — this is what prevents duplicate/leaked listeners. */
  useEffect(() => {
    if (!active) {
      setPrivateMsgs([]);
      return;
    }
    return onSnapshot(
      query(collection(db, "privateChats", active, "messages"), orderBy("createdAt", "asc"), limit(500)),
      (snap) =>
        setPrivateMsgs(
          snap.docs.map((d) => {
            const data = d.data() as any;
            return { id: d.id, ...data, text: data.text ?? data.message ?? "" } as Msg;
          })
        ),
      (e) => setError(e.message)
    );
  }, [active]);

  const messages = mode === "community" ? community : privateMsgs;
  const activeConvo = useMemo(() => convos.find((c) => c.id === active) || null, [convos, active]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, active, mode]);

  /* -------- actions -------- */
  async function send() {
    const value = draft.trim();
    if (!value || sending) return;
    setSending(true);
    const replyPayload = reply ? { id: reply.id, text: textOf(reply), senderName: reply.senderName || "Student" } : null;

    try {
      if (mode === "community") {
        await addDoc(collection(db, "communityMessages"), {
          message: value,
          text: value,
          senderId: currentUid,
          senderName: "Student",
          senderPhoto: null,
          createdAt: serverTimestamp(),
          replyTo: replyPayload,
        });
      } else {
        const c = activeConvo;
        if (!c) throw new Error("Select a private chat first");
        await addDoc(collection(db, "privateChats", c.id, "messages"), {
          message: value,
          text: value,
          senderId: currentUid,
          senderName: "Student",
          senderPhoto: null,
          createdAt: serverTimestamp(),
          replyTo: replyPayload,
          seenBy: [currentUid],
        });
        await setDoc(
          doc(db, "privateChatMeta", c.id),
          {
            participants: c.participants,
            lastMessage: value,
            lastMessageAt: serverTimestamp(),
            [`unread_${c.other.uid}`]: increment(1),
          },
          { merge: true }
        );
      }
      setDraft("");
      setReply(null);
    } catch (e: any) {
      setError(e.message || "Message failed");
    } finally {
      setSending(false);
    }
  }

  // Debounced so every keystroke doesn't trigger a fresh Firestore read.
  function searchPeople(value: string) {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) {
      setPeople([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const snap = await getDocs(query(collection(db, "users"), limit(100)));
        const needle = value.toLowerCase();
        setPeople(
          snap.docs
            .map((d) => {
              const x = d.data() as any;
              return {
                uid: d.id,
                displayName: x.name || x.displayName || "Student",
                photoURL: x.photoURL || null,
                online: x.isOnline ?? x.online ?? false,
                email: x.email ?? null,
              } as Person;
            })
            .filter(
              (p) =>
                p.uid !== currentUid &&
                (p.uid.toLowerCase().includes(needle) ||
                  p.displayName.toLowerCase().includes(needle) ||
                  (p.email || "").toLowerCase().includes(needle))
            )
            .slice(0, 15)
        );
      } catch (e: any) {
        setError(e.message);
      }
    }, 300);
  }

  async function startChat(p: Person) {
    const id = conversationId(currentUid, p.uid);
    await setDoc(
      doc(db, "privateChatMeta", id),
      {
        participants: [currentUid, p.uid].sort(),
        lastMessage: "",
        lastMessageAt: serverTimestamp(),
        [`unread_${currentUid}`]: 0,
        [`unread_${p.uid}`]: 0,
      },
      { merge: true }
    );
    setActive(id);
    setMode("private");
    setShowPeople(false);
    setSearch("");
    setPeople([]);
  }

  function openConvo(id: string) {
    setActive(id);
    updateDoc(doc(db, "privateChatMeta", id), { [`unread_${currentUid}`]: 0 }).catch(() => {});
  }

  async function removeMessage(m: Msg) {
    try {
      const ref =
        mode === "community" ? doc(db, "communityMessages", m.id) : doc(db, "privateChats", active as string, "messages", m.id);
      await updateDoc(ref, { deleted: true, deletedBy: currentUid });
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="chat-app">
      <div className="ambient-bg" aria-hidden="true">
        <div className="ambient-blob ambient-blob--a" />
        <div className="ambient-blob ambient-blob--b" />
      </div>

      <nav className="tab-bar">
        <div className="tab-track">
          <div className={`tab-pill ${mode === "private" ? "is-private" : ""}`} />
          <button
            className={`tab-btn ${mode === "community" ? "active" : ""}`}
            onClick={() => {
              setMode("community");
              // Clearing `active` unsubscribes the private-messages listener
              // (see the effect keyed on `active`) so it never keeps running
              // in the background after leaving the conversation.
              setActive(null);
              setActionId(null);
            }}
          >
            <Users size={17} />
            Community
          </button>
          <button
            className={`tab-btn ${mode === "private" ? "active" : ""}`}
            onClick={() => {
              setMode("private");
              setActionId(null);
            }}
          >
            <AtSign size={17} />
            Private
          </button>
        </div>
      </nav>

      {error && (
        <div className="error-toast">
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      <div className="chat-body">
        {mode === "private" && (
          <ConversationList
            convos={convos}
            active={active}
            hideOnMobile={!!active}
            onOpen={openConvo}
            onNewChat={() => setShowPeople(true)}
          />
        )}

        <section className="chat-panel">
          {mode === "private" && active && (
            <ChatPanelHeader convo={activeConvo} onBack={() => setActive(null)} />
          )}

          {mode === "private" && !active ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <AtSign size={24} />
              </div>
              <h2>Your private chats</h2>
              <p>Select a conversation or start a new one.</p>
            </div>
          ) : (
            <>
              <MessageList
                listRef={listRef}
                messages={messages}
                mode={mode}
                currentUid={currentUid}
                actionId={actionId}
                setActionId={setActionId}
                onReply={setReply}
                onDelete={removeMessage}
              />

              <Composer
                draft={draft}
                setDraft={setDraft}
                onSend={send}
                sending={sending}
                reply={reply}
                onClearReply={() => setReply(null)}
                placeholder={mode === "community" ? "Message everyone…" : `Message ${activeConvo?.other.displayName || ""}…`}
              />
            </>
          )}
        </section>
      </div>

      {showPeople && (
        <PeopleModal
          search={search}
          people={people}
          onSearch={searchPeople}
          onPick={startChat}
          onClose={() => {
            setShowPeople(false);
            setSearch("");
            setPeople([]);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
   Conversation list (private mode sidebar)
   ============================================================ */
function ConversationList({
  convos,
  active,
  hideOnMobile,
  onOpen,
  onNewChat,
}: {
  convos: Convo[];
  active: string | null;
  hideOnMobile: boolean;
  onOpen: (id: string) => void;
  onNewChat: () => void;
}) {
  return (
    <aside className={`conversation-list ${hideOnMobile ? "hide-mobile" : ""}`}>
      <div className="conversation-list-header">
        <div className="titles">
          <b>Private chats</b>
          <small>{convos.length} conversation{convos.length === 1 ? "" : "s"}</small>
        </div>
        <button className="icon-btn" onClick={onNewChat} aria-label="Start a new private chat">
          <UserPlus size={17} />
        </button>
      </div>

      {!convos.length ? (
        <div className="empty-conversations">
          No private chats yet.
          <button onClick={onNewChat}>
            <UserPlus size={13} /> Find a person
          </button>
        </div>
      ) : (
        convos.map((c, i) => (
          <button
            key={c.id}
            className={`conversation-item ${active === c.id ? "active" : ""}`}
            style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
            onClick={() => onOpen(c.id)}
          >
            <span className="avatar-wrap">
              {c.other.photoURL ? (
                <span className="avatar">
                  <img src={c.other.photoURL} alt="" />
                </span>
              ) : (
                <span className="avatar">{c.other.displayName[0]}</span>
              )}
              {c.other.online && <span className="avatar-online-dot" />}
            </span>
            <span className="conversation-main">
              <span className="conversation-name">{c.other.displayName}</span>
              <span className="conversation-preview">{c.lastMessage || "Start a conversation"}</span>
            </span>
            <span className="conversation-side">
              <span className="conversation-time">{timeOf(c.lastMessageAt)}</span>
              {c.unread > 0 && <span className="unread-badge">{c.unread}</span>}
            </span>
          </button>
        ))
      )}
    </aside>
  );
}

/* ============================================================
   Chat panel header (private mode)
   ============================================================ */
function ChatPanelHeader({ convo, onBack }: { convo: Convo | null; onBack: () => void }) {
  if (!convo) return null;
  return (
    <header className="chat-panel-header">
      <button className="back-btn" onClick={onBack} aria-label="Back to conversations">
        <ChevronLeft size={20} />
      </button>
      {convo.other.photoURL ? (
        <span className="avatar">
          <img src={convo.other.photoURL} alt="" />
        </span>
      ) : (
        <span className="avatar">{convo.other.displayName[0]}</span>
      )}
      <div className="chat-panel-title">
        <b>{convo.other.displayName}</b>
        <small>
          <span className={`status-dot ${convo.other.online ? "online" : ""}`} />
          {convo.other.online ? "Online" : "Offline"}
        </small>
      </div>
    </header>
  );
}

/* ============================================================
   Message list
   ============================================================ */
function MessageList({
  listRef,
  messages,
  mode,
  currentUid,
  actionId,
  setActionId,
  onReply,
  onDelete,
}: {
  listRef: RefObject<HTMLDivElement>;
  messages: Msg[];
  mode: "community" | "private";
  currentUid: string;
  actionId: string | null;
  setActionId: (id: string | null) => void;
  onReply: (m: Msg) => void;
  onDelete: (m: Msg) => void;
}) {
  return (
    <div className="message-list" ref={listRef}>
      {!messages.length && (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Users size={24} />
          </div>
          <h2>{mode === "community" ? "Community Chat" : "No messages yet"}</h2>
          <p>{mode === "community" ? "Be the first to say hello." : "Send the first message."}</p>
        </div>
      )}

      {messages.map((m, i) => {
        const mine = m.senderId === currentUid;
        const showDay = !i || dayOf(messages[i - 1].createdAt) !== dayOf(m.createdAt);

        return (
          <div key={m.id}>
            {showDay && (
              <div className="day-divider">
                <span>{dayOf(m.createdAt) || "Today"}</span>
              </div>
            )}
            <div className={`message-row ${mine ? "own" : ""}`}>
              {!mine && <span className="avatar avatar-sm">{(m.senderName || "S")[0]}</span>}
              <div className="message-wrap">
                {!mine && <small className="sender-name">{m.senderName || "Student"}</small>}
                <button
                  className={`message-bubble ${m.deleted ? "deleted" : ""}`}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setActionId(m.id);
                  }}
                  onClick={() => setActionId(actionId === m.id ? null : m.id)}
                >
                  {m.replyTo && (
                    <span className="reply-quote">
                      <b>{m.replyTo.senderName || "Student"}</b>
                      <span>{m.replyTo.text || ""}</span>
                    </span>
                  )}
                  {m.deleted ? "This message was deleted" : <span>{textOf(m)}</span>}
                  <span className="message-meta">
                    {timeOf(m.createdAt)}{" "}
                    {mine && (m.seenBy?.includes(currentUid) ? <CheckCheck size={12} className="seen" /> : <Check size={12} />)}
                  </span>
                </button>

                {actionId === m.id && (
                  <div className="context-menu">
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(textOf(m));
                        setActionId(null);
                      }}
                    >
                      <Copy size={14} /> Copy
                    </button>
                    <button
                      onClick={() => {
                        onReply(m);
                        setActionId(null);
                      }}
                    >
                      <Reply size={14} /> Reply
                    </button>
                    {mine && !m.deleted && (
                      <button
                        className="danger"
                        onClick={() => {
                          onDelete(m);
                          setActionId(null);
                        }}
                      >
                        <Trash2 size={14} /> Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   Composer
   ============================================================ */
function Composer({
  draft,
  setDraft,
  onSend,
  sending,
  reply,
  onClearReply,
  placeholder,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  reply: Msg | null;
  onClearReply: () => void;
  placeholder: string;
}) {
  return (
    <footer className="composer">
      {reply && (
        <div className="reply-preview">
          <Reply size={15} />
          <div className="body">
            <b>Replying to {reply.senderName || "Student"}</b>
            <span>{textOf(reply)}</span>
          </div>
          <button onClick={onClearReply} aria-label="Cancel reply">
            <X size={15} />
          </button>
        </div>
      )}
      <div className="composer-row">
        <input
          className="composer-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={placeholder}
        />
        <button
          className={`send-btn ${draft.trim() ? "ready" : ""}`}
          onClick={onSend}
          disabled={!draft.trim() || sending}
          aria-label="Send message"
        >
          {sending ? <span className="mini-loader" /> : <Send size={17} />}
        </button>
      </div>
    </footer>
  );
}

/* ============================================================
   New private chat modal
   ============================================================ */
function PeopleModal({
  search,
  people,
  onSearch,
  onPick,
  onClose,
}: {
  search: string;
  people: Person[];
  onSearch: (v: string) => void;
  onPick: (p: Person) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="titles">
            <b>New private chat</b>
            <small>Find a Next Toppers user</small>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>

        <div className="search-box">
          <Search size={16} />
          <input
            autoFocus
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name, email or UID"
          />
        </div>

        <div className="person-list">
          {people.map((p, i) => (
            <button key={p.uid} className="person-row" style={{ animationDelay: `${i * 25}ms` }} onClick={() => onPick(p)}>
              {p.photoURL ? (
                <span className="avatar">
                  <img src={p.photoURL} alt="" />
                </span>
              ) : (
                <span className="avatar">{p.displayName[0]}</span>
              )}
              <span className="body">
                <b>{p.displayName}</b>
                <small>{p.email || p.uid}</small>
              </span>
              <Send size={15} className="go" />
            </button>
          ))}
          {!people.length && <div className="empty-search">Start typing to find users.</div>}
        </div>
      </div>
    </div>
  );
}
