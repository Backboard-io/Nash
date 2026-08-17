# BYOK (Bring Your Own Key) — Architecture & Flow

> **Post-migration note (May 2026).** Earlier revisions of this doc described
> a two-token model (a JWT for identity + a `session_key` cookie for the
> encrypted BYOK key) and called the session row a "blind store" with no
> user identity. After the JWT removal, the session_key cookie is the **only**
> auth credential and the session row now carries a `user_id` field so it can
> power identity-aware routes (admin, share-links) that used to require a
> JWT. The encryption-key isolation property is unchanged — the BYOK material
> is still AES-256-GCM wrapped at rest. If you see references to JWTs,
> refresh tokens, or "blind store — no user identity" anywhere downstream,
> those are stale.

## Flow Chart

```mermaid
flowchart TD
    subgraph Frontend["Frontend (React)"]
        A[User enters API key in login form]
        B[POST /api/keys<br/>provider: backboard<br/>apiKey: espr_...]
        C[Browser stores httpOnly<br/>session_key cookie]
        E[All subsequent requests<br/>auto-send session_key cookie]
        F[SSE connections send<br/>session_key via cookie or<br/>X-Session-Key header]
    end

    subgraph Backend["Backend (Flask)"]
        subgraph KeySubmission["POST /api/keys"]
            G[Receive apiKey + provider]
            H{Validate key against<br/>Backboard billing API}
            I[Discover or create<br/>nash-main on Backboard]
            K[AES-256-GCM encrypt<br/>the API key]
            L[Generate session_key<br/>nash_sk_ + 256-bit random]
            M[Store in DynamoDB<br/>incl. user_id +<br/>last_used_at]
            N[Return session_key body<br/>+ set httpOnly cookie]
        end

        subgraph SessionAuth["require_auth middleware"]
            O{session_key cookie<br/>or X-Session-Key<br/>header present?}
            P[DynamoDB lookup<br/>by session_key]
            Q{Session found<br/>and not expired?}
            R[AES-256-GCM decrypt<br/>API key in memory]
            S["Set g.user_id<br/>g.bb_api_key<br/>g.chat_assistant_id"]
            T[touch_session — bump<br/>last_used_at + ttl,<br/>throttled to once<br/>per 5 min]
            V[401 Unauthorized]
        end

        subgraph RequestHandling["Route Handler"]
            W[get_request_client<br/>reads g.bb_api_key]
            X[Create BackboardClient<br/>with decrypted key]
            Y[Call Backboard API<br/>chat, conversations, etc.]
            Z[Return response to client]
        end
    end

    subgraph DynamoDB["DynamoDB Session Table"]
        DB[(session_key →<br/>user_id, encrypted_key,<br/>provider, assistant_id,<br/>last_used_at, ttl)]
    end

    subgraph Backboard["Backboard API"]
        BB[LLM Gateway<br/>100+ models]
    end

    A --> B
    B --> G
    G --> H
    H -->|Invalid| V
    H -->|Valid| I
    I --> K
    K --> L
    L --> M
    M --> DB
    N --> C

    C --> E
    E --> O
    O -->|Yes| P
    P --> DB
    DB --> Q
    Q -->|No| V
    Q -->|Yes| R
    R --> S
    S --> T
    T --> W
    O -->|No| V
    W --> X
    X --> Y
    Y --> BB
    BB --> Z

    style DB fill:#1a1a2e,color:#e94560,stroke:#e94560
    style V fill:#c0392b,color:#fff
    style BB fill:#2c3e50,color:#ecf0f1
    style K fill:#27ae60,color:#fff
    style R fill:#27ae60,color:#fff
    style L fill:#2980b9,color:#fff
```

## Session Lifecycle

```mermaid
sequenceDiagram
    participant U as User/Browser
    participant F as Frontend
    participant B as Backend (Flask)
    participant D as DynamoDB
    participant BB as Backboard API

    Note over U,BB: 1. Key Submission
    U->>F: Enter Backboard API key
    F->>B: POST /api/keys {provider, apiKey}
    B->>BB: list_assistants() — validate key
    BB-->>B: 200 OK
    B->>BB: discover or create nash-main
    BB-->>B: chat_assistant_id
    B->>B: AES-256-GCM encrypt(apiKey)
    B->>B: generate session_key (256-bit)
    B->>D: store {session_key, user_id, encrypted_key,<br/>assistant_id, created_at, last_used_at, ttl=30d}
    B-->>F: {session_key, provider, ttl_hours} +<br/>Set-Cookie: session_key (httpOnly)

    Note over U,BB: 2. Every Authenticated Request
    F->>B: GET /api/init (Cookie: session_key)
    B->>D: get_session(session_key)
    D-->>B: {user_id, encrypted_key, assistant_id, ttl}
    B->>B: Check TTL ≤ now? → reject if expired
    B->>B: AES-256-GCM decrypt(encrypted_key)
    B->>B: Set g.user_id, g.bb_api_key, g.chat_assistant_id
    B->>D: touch_session — UpdateItem only if<br/>last_used_at > 5 min old
    B->>BB: API call with decrypted key
    BB-->>B: Response
    B-->>F: JSON response

    Note over U,BB: 3. Logout
    F->>B: POST /api/auth/logout (Cookie: session_key)
    B->>D: delete_session(session_key)
    D-->>B: Deleted
    B-->>F: 200 + Set-Cookie clears session_key

    Note over U,BB: 4. Idle Expiry
    Note over D: After 14 days with no touch_session,<br/>DynamoDB native TTL drops the row
```

## DynamoDB Schema

Nash uses **two** DynamoDB tables. The session table (`nash`) holds one
row per active login, identified by an opaque `session_key`. User identity
and profile data live in the separate `nash_state` table (see
[api/services/state_service.py](../api/services/state_service.py)) as
`PROFILE#<user_id>` rows with `EMAIL#<email>` and `SUB#<backboard_sub>`
lookup-index rows pointing back to the canonical profile.

```
Table: nash  (sessions)
Key: session_key (String, HASH)
TTL: ttl (Number, epoch seconds — sliding, bumped on use)

Item:
┌──────────────────┬──────────────────────────────────────────┐
│ session_key      │ nash_sk_9Ft7rA2-0AL9mgcvLO8zl5Qxy...     │
│ user_id          │ <Nash user id — usually sha256(api_key)> │
│ encrypted_key    │ JV21oZtneJygn88CrHUHubQpadUm...          │
│ provider         │ backboard                                │
│ chat_assistant_id│ a1b2c3d4-...                             │
│ created_at       │ 2026-05-20T08:50:38+00:00                │
│ last_used_at     │ 1779000000                               │
│ ttl              │ 1779950400                               │
└──────────────────┴──────────────────────────────────────────┘

Table: nash_state  (user identity + Nash-internal state)
Key: pk (String, HASH) — e.g. PROFILE#<user_id>, EMAIL#<email>, SUB#<sub>
```

## Security Properties

| Property | Implementation |
|----------|---------------|
| Key at rest | AES-256-GCM encrypted in DynamoDB |
| Key in transit | HTTPS + httpOnly cookie |
| Key in memory | Only during request, garbage collected after |
| Key in logs | Never — audit logs only record event names |
| Key in response | Never — only session_key returned to client |
| Session entropy | 256-bit (secrets.token_urlsafe) |
| Session TTL | 30 days sliding by default (configurable via `SESSION_TTL_DAYS`) |
| TTL bumping | Throttled to once per `SESSION_TOUCH_MIN_INTERVAL_SECONDS` (default 300) |
| TTL enforcement | Double: application check + DynamoDB native TTL |
| Identity in session row | `user_id` only — no email, name, or secrets |
| Logout | Deletes the DynamoDB row — immediate revocation, replica-agnostic |
| Cookie flags | httpOnly, Secure (in prod), SameSite=Lax |
