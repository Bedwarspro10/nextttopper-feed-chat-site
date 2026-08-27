interface Env {
  FIREBASE_API_KEY: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_SERVICE_ACCOUNT_EMAIL: string;
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: string;
}

type FirebaseLookupResponse = {
  users?: Array<{
    localId?: string;
    email?: string;
    disabled?: boolean;
  }>;
  error?: { message?: string };
};

const ALLOWED_ORIGIN = "https://nexttopper-feed-chat-site.pages.dev";

function json(data: unknown, status = 200, origin = ALLOWED_ORIGIN) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64Url(bytes: Uint8Array | string): string {
  const input = typeof bytes === "string"
    ? new TextEncoder().encode(bytes)
    : bytes;
  let binary = "";
  for (const b of input) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(JSON.stringify(value));
}

async function signCustomToken(
  uid: string,
  serviceAccountEmail: string,
  privateKeyPem: string,
) {
  const now = Math.floor(Date.now() / 1000);

  // Firebase custom-token JWT format.
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccountEmail,
    sub: serviceAccountEmail,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid,
  };

  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );

  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  const origin = request.headers.get("Origin") || "";
  if (origin !== ALLOWED_ORIGIN && origin !== "") {
    return new Response(null, { status: 403 });
  }
  return json({}, 204, origin || ALLOWED_ORIGIN);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("Origin") || "";
  if (origin && origin !== ALLOWED_ORIGIN) {
    return json({ error: "Origin not allowed." }, 403);
  }

  try {
    const body = await request.json().catch(() => null) as { idToken?: string } | null;
    const idToken = body?.idToken?.trim();

    if (!idToken || idToken.length > 10000) {
      return json({ error: "Missing Firebase ID token." }, 400);
    }

    if (
      !env.FIREBASE_API_KEY ||
      !env.FIREBASE_PROJECT_ID ||
      !env.FIREBASE_SERVICE_ACCOUNT_EMAIL ||
      !env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY
    ) {
      return json({ error: "Authentication service is not configured." }, 500);
    }

    // Firebase Identity Toolkit validates the Firebase ID token and
    // returns the authenticated Firebase localId (UID).
    const lookupResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      },
    );

    const lookup = await lookupResponse.json() as FirebaseLookupResponse;
    const firebaseUser = lookup.users?.[0];

    if (!lookupResponse.ok || !firebaseUser?.localId || firebaseUser.disabled) {
      return json({ error: "Firebase authentication could not be verified." }, 401);
    }

    // Mint a short-lived Firebase custom token for the web Firebase client.
    const customToken = await signCustomToken(
      firebaseUser.localId,
      env.FIREBASE_SERVICE_ACCOUNT_EMAIL,
      env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
    );

    return json({
      customToken,
      uid: firebaseUser.localId,
    });
  } catch (error) {
    console.error("Firebase auth exchange error:", error);
    return json({ error: "Authentication exchange failed." }, 500);
  }
};
