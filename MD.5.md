# 🍩 Roast & Donut — Master Development Log (MD.5)

This document tracks the complete architecture, logic, and implementation status of the Roast & Donut project.

---

## 🏗️ 1. Architecture Overview

- **Backend**: Node.js + Express
- **Database**: Neon Postgres (Serverless)
- **Frontend**: React (Vite) + Vanilla CSS
- **Authentication**: JWT (JSON Web Tokens) with 7-day expiry and bcrypt hashing.
- **Security**: Helmet, CORS, and SQL parameterization.

---

## 🗄️ 2. Database Schema (Neon)

We are using a pre-existing schema with a mix of high-performance tables and real-time views.

### Core Tables
- **`users`**: Emails, hashed passwords, admin levels, shadow-ban status, country, and verification status.
- **`posts`**: Core content table with `burn_at`, `scheduled_for`, `category`, and `is_flagged` flags.
- **`post_interactions`**: Tracks likes, dislikes, ratings, and shares.
- **`comments`**: Threaded interaction on posts.
- **`admin_actions`**: Comprehensive audit log for every "God Mode" action.
- **`security_audit`**: Tracks logins, failed attempts, and sensitive events.

### Optimized Views
- **`v_main_feed`**: Default chronological feed.
- **`v_trending_feed`**: Weighted feed based on `heat_index`.
- **`v_admin_master_stats`**: High-level system health metrics.
- **`v_roast_heat_map`**: Geographical engagement data.

---

## 🛠️ 3. Backend Logic (`server.js`)

### Auth & Security
```javascript
// Lockout logic: 5 failed attempts = 15 minute lock
if ((user.failed_attempts || 0) + 1 >= 5) {
  await query("UPDATE users SET locked_until = NOW() + INTERVAL '15 minutes' WHERE id = $1", [user.id]);
}
```

### User Sovereignty (Self-Destruct & Scheduling)
Implemented logic for users to control their data lifespan:
- **`burn_at`**: A specific timestamp when the post is automatically hidden/deleted.
- **`scheduled_for`**: Future-dated publication for drafts.

### Search Logic (Fuzzy pg_trgm)
We enabled the `pg_trgm` extension and created GIN indexes for high-speed fuzzy searching.
```javascript
// Post Search
`SELECT * FROM v_main_feed WHERE title % $1 OR content % $1 
 ORDER BY similarity(title, $1) DESC LIMIT 50`

// User Search
`SELECT id, email FROM users WHERE email % $1 ORDER BY similarity(email, $1) DESC LIMIT 20`
```

---

## ⚡ 4. God Mode (Admin Dashboard)

The backend exposes several "God Mode" endpoints strictly for users with `is_admin = true`.

| Logic | Action |
|-------|--------|
| **Flagging** | Instantly mark posts as NSFW/Flagged. |
| **Edit Locking** | Prevents the original author from modifying content. |
| **Shadow Banning** | User can still post but content is hidden from others. |
| **Audit Log** | Every admin action records the `ip_address`, `reason`, and `target_id`. |

---

## 🎨 5. Frontend Components (`MainFeed.jsx`)

### Feed Controller
Handles tab-switching between **🍩 Main**, **🔥 Trending**, and **🔍 Search**.

### Search Debouncing
```javascript
useEffect(() => {
  if (tab === "search") {
    const timer = setTimeout(() => fetchFeed(), 300); // 300ms debounce
    return () => clearTimeout(timer);
  }
}, [searchQuery]);
```

### Filtering System
Dynamically pulls distinct categories from the backend and provides "Chip" filters. It also displays a **Daily Roast Winner** banner at the top of the feed.

---

## 🚀 6. Current Implementation Status

- [x] Neon Database Connection
- [x] Basic Auth (Register/Login/Lockout)
- [x] Main & Trending Feeds (View-based)
- [x] Category Filtering
- [x] User Sovereignty (Burn/Schedule)
- [x] God Mode Admin API
- [x] Fuzzy Global Search (Posts + Users)
- [ ] Detailed Admin UI Components
- [ ] Profile Settings Dashboard
- [ ] Real-time Notifications (Socket/Polling)


---

## 💎 7. Error Handling & Obsidian Tooltips

For all system failures, we depart from standard UX and use **3D Obsidian Glass** objects. 

### Design Identity
- **Surface**: `rgba(18, 18, 18, 0.85)` with 25px backdrop blur.
- **Edge**: Metallic chrome 1px border (`linear-gradient`).
- **Depth**: Triple-layered shadow system (ambient + projection + inner glow).

### Logic Mapping
| Scenario | DB Column Source | Tooltip Text |
|----------|-----------------|--------------|
| Login Fail | `failed_attempts` | "Credentials not recognized by the engine." |
| Lockout | `locked_until` | "System cooling down. Please wait until the timer expires." |
| Age Gate | `birthdate` | "Access restricted. Valid 21+ identification required." |
| Self-Destruct | `burn_at` | "The roast you are looking for has already self-destructed." |
| Admin Block | `restriction_scope` | "Your account permissions are currently limited by an admin." |

### Behavioral Specs
- **The Pop**: Tooltips enter via a bottom-up 3D pop (`y: 10` to `y: 0`).
- **The 3D Shake**: Repeating an error causes a 3D tilt-shake instead of a flat blink.


---

## 🏗️ 8. Blueprint Loading & Data-State Mapping

We have replaced standard loading spinners with the **Blueprint Sequence**—a series of shimmering bento skeletons and a minimalist progress line.

### Design Identity
- **Global Overlay**: `#F4F4F4` canvas with `#E5E5E5` dot grid.
- **Progress Line**: 1px `#737373` line at the top of the screen (0% to 100%).
- **Text**: "Synchronizing with Neon Engine..." in SF Pro Rounded with a soft pulse.
- **Shimmer Effect**: Skeletons use a `shimmer` animation (`translateX` from -100% to 100%).

### Behavioral Rules
- **The Auto-Exit**: The loader slides up and fades out (`y: -20`, `opacity: 0`) once the data is resolved.
- **Cross-Fade Transition**: Skeleton cards flip to real content cards with a 0.3s cross-fade.
- **Selective Loading**: The `LoadingScreen` overlay triggers on initial fetches, while skeleton cards handle background updates in the feed.


---

## 🟢 9. Status Heartbeats & Activity Orbs

We track user presence and Moderation states using high-fidelity **Status Orbs** (4px glowing dots).

### Activity Logic
- **Online (🟢 #28CD41)**: `last_seen_at` within the last 5 minutes. Includes a 3D glow.
- **Offline (⚪ #737373)**: Shows as "Online 5m ago" (calculated via `date-fns`).
- **Blocked (⚫ #000000)**: Visible specifically when a user-to-user block exists in `user_blocks`.
- **Banned (🟡 #FFCC00)**: Global suspension state (`is_banned`).

### Database Integration
- **Heartbeat**: Every request to an `authRequired` endpoint updates the `last_seen_at` timestamp in real-time.
- **Security Logic**: If `is_banned` is TRUE, the backend instantly rejects all requests with a **403 Forbidden** and the Obsidian "Security Lockout" message.

### UI Specs
- **Typography**: SF Pro Rounded, 11pt, #737373 for relative timestamps.
- **Glow**: Dots use `box-shadow: 0 0 8px` matching their status color to maintain a 3D physical feel.


---

## 🛡️ 10. User Control Center & Advanced Metrics

We have implemented the **`v_admin_user_control_center`** engine to provide admins with deep intelligence on user behavior.

### High-Fidelity Intelligence
- **Report Aggregation**: The view automatically joins `reports` with `posts` to attribute flags directly to the author.
- **Block Tracking**: Monitors `times_blocked_by_others` via the `user_blocks` table.
- **Dynamic Status**: Calculates `status_label` ('online', 'offline', 'banned') on the fly based on realtime heartbeats.

### Admin API Integration
- **Default Sort**: The user list now prioritizes **High-Risk Profiles** (ordered by `report_count DESC`), followed by the most recently active users.

---

## 🚪 11. Frontend Page Hierarchy (Complete)

All pages are served from `/pages/` as static HTML, fully connected to the backend API.

### 1. The Entrance (Auth & Onboarding)
| Page | File | Backend Connection |
|------|------|--------------------|
| Landing Page | `index.html` | Static (links to feed/login) |
| Login | `login.html` | `POST /api/auth/login` |
| Register | `register.html` | `POST /api/auth/register` |
| Age Gate | `age-gate.html` | Client-side birthdate check |
| Forgot Password | `forgot-password.html` | Placeholder (email flow) |
| Account Locked | `locked.html` | Redirect from 423 responses |

### 2. Core Engine (Feeds & Content)
| Page | File | Backend Connection |
|------|------|--------------------|
| Main Feed | `feed.html` | `GET /api/feed/main`, `/trending`, `/categories` |
| Single Post | `post.html?id=` | `GET /api/feed/main` + `/api/posts/:id/comments` |
| Composer | `create.html` | `POST /api/posts` |
| Search | `feed.html` (tab) | `GET /api/search/posts`, `/search/users` |

### 3. User Sovereignty (Dashboard & Profile)
| Page | File | Backend Connection |
|------|------|--------------------|
| Dashboard | `dashboard.html` | `GET /api/user/dashboard`, `/posts`, `/notifications`, `/badges` |
| Notifications | `notifications.html` | `GET /api/user/notifications`, `PATCH /:id/read` |
| Account Settings | `settings.html` | `GET /api/user/dashboard` |
| Privacy & Blocks | `settings-privacy.html` | `POST /api/user/block/:userId` |

### 4. God Mode (Admin)
| Page | File | Backend Connection |
|------|------|--------------------|
| Admin Panel | `admin.html` | `GET /api/admin/stats`, `/users`, `/reports`, `/audit`, `/actions` |

### 5. System States
| Page | File |
|------|------|
| 404 | `404.html` |
| 500 | `500.html` |
| Maintenance | `maintenance.html` |

### 6. Legal
| Page | File |
|------|------|
| Terms of Service | `legal-terms.html` |
| Privacy Policy | `legal-privacy.html` |

### Design Rules Applied
- ✅ Zero bold text (`font-weight: 400 !important`)
- ✅ `#F4F4F4` background with `#E5E5E5` dot matrix
- ✅ Bento cards: white, 1px border, 16px radius
- ✅ Hover transitions: `#737373` → `#000000` (0.2s linear)
- ✅ Link underlines grow from center
- ✅ Images at 50% saturation → full color on hover
- ✅ Staggered fade-in animations
- ✅ Blueprint skeleton loading
- ✅ Obsidian error tooltips
- ✅ Status Orbs on user presence

### 🛡️ Deployment & Security Fix (Render)
- **Problem**: Default Helmet CSP was blocking Tailwind CDN, Google Fonts, and all inline JavaScript logic, effectively "killing" the site's interactivity and styling.
- **Fix**: Custom Helmet configuration implemented in `server.js` to allow:
    - `script-src`: `'self'`, `'unsafe-inline'`, `https://cdn.tailwindcss.com`
    - `style-src`: `'self'`, `'unsafe-inline'`, `https://fonts.googleapis.com`
    - `font-src`: `https://fonts.gstatic.com`
    - `img-src`: `https://*` (allows external coffee/pastry image assets)

---

*Last Updated: 2026-03-02 00:35 (Project: Roast & Donut)*
