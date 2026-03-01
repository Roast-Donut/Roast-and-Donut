/* ═══════════════════════════════════════════════════════════
   ROAST & DONUT  —  server.js
   Fully functional Express API backed by Neon Postgres.
   Tables used: users, posts, post_interactions, comments,
                reports, admin_actions, user_restrictions,
                auth_tokens, notifications, badges,
                security_audit, user_blocks
   Views used:  v_main_feed, v_trending_feed, v_filtered_feed,
                v_admin_report_center, v_admin_master_stats,
                v_user_dashboard, v_user_unread_counts,
                v_scheduled_tasks, v_daily_roast_winner,
                v_roast_heat_map
   ═══════════════════════════════════════════════════════════ */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

// ── Postgres Pool ─────────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// ── Express App ───────────────────────────────────────────
const app = express();
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com"],
            "img-src": ["'self'", "data:", "https://*"],
            "connect-src": ["'self'"],
        },
    },
}));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*", credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(morgan("dev"));

// ── Serve static frontend pages ───────────────────────────
app.use(express.static(path.join(__dirname, "pages")));

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */

const query = (text, params) => pool.query(text, params);

function signToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, is_admin: user.is_admin, admin_level: user.admin_level },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );
}

/* ═══════════════════════════════════════════════════════════
   MIDDLEWARE
   ═══════════════════════════════════════════════════════════ */

// Authenticate any user (sets req.user)
async function authRequired(req, res, next) {
    try {
        const token =
            req.headers.authorization?.split(" ")[1] || req.cookies?.token;
        if (!token) return res.status(401).json({ error: "Authentication required" });

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Fetch user with new status columns
        const { rows } = await query(
            "SELECT id, email, is_admin, admin_level, is_shadow_banned, is_banned, last_seen_at FROM users WHERE id = $1",
            [decoded.id]
        );

        if (!rows.length) return res.status(401).json({ error: "User not found" });

        const user = rows[0];

        // Check for global ban
        if (user.is_banned) {
            return res.status(403).json({ error: "Your account has been suspended by an administrator." });
        }

        // Heartbeat: Update last_seen_at
        await query("UPDATE users SET last_seen_at = NOW() WHERE id = $1", [user.id]);

        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}

// Admin-only gate (must follow authRequired)
function adminRequired(req, res, next) {
    if (!req.user?.is_admin) return res.status(403).json({ error: "Admin access required" });
    next();
}

/* ═══════════════════════════════════════════════════════════
   AUTH ROUTES
   ═══════════════════════════════════════════════════════════ */

// POST /api/auth/register
app.post("/api/auth/register", async (req, res) => {
    try {
        const { email, password, country, birthdate } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Email and password required" });

        // Check blocklist
        const { rows: blocked } = await query("SELECT 1 FROM password_blocklist WHERE weak_pwd = $1", [password]);
        if (blocked.length) return res.status(400).json({ error: "That password is too common. Choose a stronger one." });

        const password_hash = await bcrypt.hash(password, 12);
        const id = uuidv4();

        const { rows } = await query(
            `INSERT INTO users (id, email, password_hash, country, birthdate, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, email, is_admin, admin_level`,
            [id, email, password_hash, country || null, birthdate || null]
        );

        const token = signToken(rows[0]);
        res.status(201).json({ user: rows[0], token });
    } catch (err) {
        if (err.code === "23505") return res.status(409).json({ error: "Email already in use" });
        console.error("Register error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: "Email and password required" });

        const { rows } = await query("SELECT * FROM users WHERE email = $1", [email]);
        if (!rows.length) return res.status(401).json({ error: "Invalid credentials" });

        const user = rows[0];

        // Check lock
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            return res.status(423).json({ error: "Account locked. Try again later." });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            // Increment failed attempts
            await query("UPDATE users SET failed_attempts = COALESCE(failed_attempts,0) + 1 WHERE id = $1", [user.id]);
            // Lock after 5 failures
            if ((user.failed_attempts || 0) + 1 >= 5) {
                await query("UPDATE users SET locked_until = NOW() + INTERVAL '15 minutes' WHERE id = $1", [user.id]);
            }
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Reset on success
        await query("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1", [user.id]);

        // Audit
        await query(
            "INSERT INTO security_audit (event_type, ip_address, details, created_at) VALUES ($1, $2, $3, NOW())",
            ["login", req.ip, `User ${user.email} logged in`]
        );

        const token = signToken(user);
        res.json({ user: { id: user.id, email: user.email, is_admin: user.is_admin, admin_level: user.admin_level }, token });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/auth/me  — return current session user
app.get("/api/auth/me", authRequired, (req, res) => {
    res.json({ user: req.user });
});

/* ═══════════════════════════════════════════════════════════
   FEED ROUTES  (v_main_feed, v_trending_feed, v_filtered_feed)
   ═══════════════════════════════════════════════════════════ */

// GET /api/feed/main?page=1&limit=20&category=roast
app.get("/api/feed/main", async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
        const offset = (page - 1) * limit;
        const { category } = req.query;

        let sql = `
            SELECT v.*, u.last_seen_at as author_last_seen_at, u.is_banned as author_is_banned 
            FROM v_main_feed v
            JOIN users u ON v.author_id = u.id
        `;
        const params = [];

        if (category) {
            params.push(category);
            sql += ` WHERE v.category = $${params.length}`;
        }

        sql += " ORDER BY created_at DESC";
        params.push(limit);
        sql += ` LIMIT $${params.length}`;
        params.push(offset);
        sql += ` OFFSET $${params.length}`;

        const { rows } = await query(sql, params);

        // Total count for pagination
        let countSql = "SELECT COUNT(*) FROM v_main_feed";
        const countParams = [];
        if (category) {
            countParams.push(category);
            countSql += ` WHERE category = $1`;
        }
        const { rows: countRows } = await query(countSql, countParams);

        res.json({
            posts: rows,
            pagination: {
                page,
                limit,
                total: parseInt(countRows[0].count),
                totalPages: Math.ceil(parseInt(countRows[0].count) / limit),
            },
        });
    } catch (err) {
        console.error("Main feed error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/feed/trending?page=1&limit=20&category=donut
app.get("/api/feed/trending", async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
        const offset = (page - 1) * limit;
        const { category } = req.query;

        let sql = `
            SELECT v.*, u.last_seen_at as author_last_seen_at, u.is_banned as author_is_banned 
            FROM v_trending_feed v
            JOIN users u ON v.author_id = u.id
        `;
        const params = [];

        if (category) {
            params.push(category);
            sql += ` WHERE category = $${params.length}`;
        }

        sql += " ORDER BY heat_index DESC NULLS LAST, created_at DESC";
        params.push(limit);
        sql += ` LIMIT $${params.length}`;
        params.push(offset);
        sql += ` OFFSET $${params.length}`;

        const { rows } = await query(sql, params);

        let countSql = "SELECT COUNT(*) FROM v_trending_feed";
        const countParams = [];
        if (category) {
            countParams.push(category);
            countSql += ` WHERE category = $1`;
        }
        const { rows: countRows } = await query(countSql, countParams);

        res.json({
            posts: rows,
            pagination: {
                page,
                limit,
                total: parseInt(countRows[0].count),
                totalPages: Math.ceil(parseInt(countRows[0].count) / limit),
            },
        });
    } catch (err) {
        console.error("Trending feed error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/feed/filtered?filter_tag=spicy&category=roast
app.get("/api/feed/filtered", async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 50);
        const offset = (page - 1) * limit;
        const { category, filter_tag } = req.query;

        let sql = `
            SELECT v.*, u.last_seen_at as author_last_seen_at, u.is_banned as author_is_banned 
            FROM v_filtered_feed v
            JOIN users u ON v.author_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (category) {
            params.push(category);
            sql += ` AND category = $${params.length}`;
        }
        if (filter_tag) {
            params.push(filter_tag);
            sql += ` AND filter_tag = $${params.length}`;
        }

        sql += " ORDER BY created_at DESC";
        params.push(limit);
        sql += ` LIMIT $${params.length}`;
        params.push(offset);
        sql += ` OFFSET $${params.length}`;

        const { rows } = await query(sql, params);
        res.json({ posts: rows, page, limit });
    } catch (err) {
        console.error("Filtered feed error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/feed/categories — distinct categories from posts
app.get("/api/feed/categories", async (_req, res) => {
    try {
        const { rows } = await query(
            "SELECT DISTINCT category FROM posts WHERE category IS NOT NULL ORDER BY category"
        );
        res.json({ categories: rows.map((r) => r.category) });
    } catch (err) {
        console.error("Categories error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/feed/daily-winner
app.get("/api/feed/daily-winner", async (_req, res) => {
    try {
        const { rows } = await query("SELECT * FROM v_daily_roast_winner LIMIT 1");
        res.json({ winner: rows[0] || null });
    } catch (err) {
        console.error("Daily winner error:", err);
        res.status(500).json({ error: "Server error" });
    }
});


/* ═══════════════════════════════════════════════════════════
   SEARCH ROUTES (Fuzzy Search via pg_trgm)
   ═══════════════════════════════════════════════════════════ */

// GET /api/search/posts?q=query
app.get("/api/search/posts", async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json({ posts: [] });

        // Leveraging GIN pg_trgm indexes on title and content
        const { rows } = await query(
            `SELECT v.*, u.last_seen_at as author_last_seen_at, u.is_banned as author_is_banned 
             FROM v_main_feed v
             JOIN users u ON v.author_id = u.id
             WHERE v.title % $1 OR v.content % $1 
             ORDER BY similarity(v.title, $1) DESC LIMIT 50`,
            [q]
        );
        res.json({ posts: rows });
    } catch (err) {
        console.error("Search posts error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/search/users?q=query
app.get("/api/search/users", async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json({ users: [] });

        // Leveraging GIN pg_trgm index on email
        const { rows } = await query(
            `SELECT id, email, pfp_url, country FROM users 
       WHERE email % $1 
       ORDER BY similarity(email, $1) DESC 
       LIMIT 20`,
            [q]
        );
        res.json({ users: rows });
    } catch (err) {
        console.error("Search users error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

/* ═══════════════════════════════════════════════════════════
   POST CRUD
   ═══════════════════════════════════════════════════════════ */

// POST /api/posts — create a new post
app.post("/api/posts", authRequired, async (req, res) => {
    try {
        const {
            title, content, category, cover_image_url,
            is_private, is_draft, allow_comments, show_stats,
            burn_at, scheduled_for,
        } = req.body;

        if (!title || !content) return res.status(400).json({ error: "Title and content required" });

        const id = uuidv4();
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const share_slug = uuidv4().slice(0, 8);

        const { rows } = await query(
            `INSERT INTO posts
        (id, author_id, title, slug, content, category, cover_image_url,
         is_private, is_draft, allow_comments, show_stats,
         burn_at, scheduled_for, share_slug, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
       RETURNING *`,
            [
                id, req.user.id, title, slug, content,
                category || null, cover_image_url || null,
                is_private ?? false, is_draft ?? false,
                allow_comments ?? true, show_stats ?? true,
                burn_at || null, scheduled_for || null,
                share_slug, is_draft ? "draft" : (scheduled_for ? "scheduled" : "published"),
            ]
        );

        res.status(201).json({ post: rows[0] });
    } catch (err) {
        console.error("Create post error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/posts/:id
app.get("/api/posts/:id", async (req, res) => {
    try {
        const { rows } = await query("SELECT * FROM posts WHERE id = $1", [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: "Post not found" });

        // Increment view count
        await query("UPDATE posts SET view_count = COALESCE(view_count,0) + 1 WHERE id = $1", [req.params.id]);

        res.json({ post: rows[0] });
    } catch (err) {
        console.error("Get post error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// PATCH /api/posts/:id
app.patch("/api/posts/:id", authRequired, async (req, res) => {
    try {
        // Verify ownership
        const { rows: existing } = await query("SELECT * FROM posts WHERE id = $1", [req.params.id]);
        if (!existing.length) return res.status(404).json({ error: "Post not found" });
        if (existing[0].author_id !== req.user.id && !req.user.is_admin) {
            return res.status(403).json({ error: "Not your post" });
        }
        if (existing[0].edit_locked && !req.user.is_admin) {
            return res.status(403).json({ error: "Post is edit-locked" });
        }

        // Save version history
        await query(
            `INSERT INTO post_versions (id, post_id, old_title, old_content, changed_at)
       VALUES ($1, $2, $3, $4, NOW())`,
            [uuidv4(), req.params.id, existing[0].title, existing[0].content]
        );

        const allowed = ["title", "content", "category", "cover_image_url",
            "is_private", "is_draft", "allow_comments", "show_stats",
            "burn_at", "scheduled_for", "status"];

        const sets = [];
        const vals = [];
        let idx = 1;
        for (const key of allowed) {
            if (req.body[key] !== undefined) {
                sets.push(`${key} = $${idx++}`);
                vals.push(req.body[key]);
            }
        }
        if (!sets.length) return res.status(400).json({ error: "Nothing to update" });

        sets.push(`updated_at = NOW()`);
        vals.push(req.params.id);

        const { rows } = await query(
            `UPDATE posts SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
            vals
        );

        res.json({ post: rows[0] });
    } catch (err) {
        console.error("Update post error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// DELETE /api/posts/:id
app.delete("/api/posts/:id", authRequired, async (req, res) => {
    try {
        const { rows } = await query("SELECT author_id FROM posts WHERE id = $1", [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: "Post not found" });
        if (rows[0].author_id !== req.user.id && !req.user.is_admin) {
            return res.status(403).json({ error: "Not your post" });
        }

        await query("DELETE FROM posts WHERE id = $1", [req.params.id]);
        res.json({ message: "Post deleted" });
    } catch (err) {
        console.error("Delete post error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

/* ═══════════════════════════════════════════════════════════
   POST INTERACTIONS  (like, dislike, rate, share)
   ═══════════════════════════════════════════════════════════ */

// POST /api/posts/:id/interact
app.post("/api/posts/:id/interact", authRequired, async (req, res) => {
    try {
        const { is_dislike, rating, is_shared } = req.body;
        const postId = req.params.id;

        // Upsert interaction
        const { rows } = await query(
            `INSERT INTO post_interactions (id, post_id, user_id, is_dislike, rating, is_shared, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (post_id, user_id) WHERE post_id IS NOT NULL
       DO UPDATE SET is_dislike = COALESCE($4, post_interactions.is_dislike),
                     rating = COALESCE($5, post_interactions.rating),
                     is_shared = COALESCE($6, post_interactions.is_shared)
       RETURNING *`,
            [uuidv4(), postId, req.user.id, is_dislike ?? false, rating ?? null, is_shared ?? false]
        );

        // If shared, bump share_count on post
        if (is_shared) {
            await query("UPDATE posts SET share_count = COALESCE(share_count,0) + 1 WHERE id = $1", [postId]);
        }

        res.json({ interaction: rows[0] });
    } catch (err) {
        console.error("Interact error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

/* ═══════════════════════════════════════════════════════════
   COMMENTS
   ═══════════════════════════════════════════════════════════ */

// GET /api/posts/:id/comments
app.get("/api/posts/:id/comments", async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT c.*, u.email AS author_email, u.pfp_url AS author_avatar
       FROM comments c JOIN users u ON c.author_id = u.id
       WHERE c.post_id = $1 ORDER BY c.created_at ASC`,
            [req.params.id]
        );
        res.json({ comments: rows });
    } catch (err) {
        console.error("Get comments error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// POST /api/posts/:id/comments
app.post("/api/posts/:id/comments", authRequired, async (req, res) => {
    try {
        const { content } = req.body;
        if (!content) return res.status(400).json({ error: "Content required" });

        // Check allow_comments flag
        const { rows: postRows } = await query("SELECT allow_comments FROM posts WHERE id = $1", [req.params.id]);
        if (!postRows.length) return res.status(404).json({ error: "Post not found" });
        if (!postRows[0].allow_comments) return res.status(403).json({ error: "Comments are disabled for this post" });

        const { rows } = await query(
            `INSERT INTO comments (id, post_id, author_id, content, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
            [uuidv4(), req.params.id, req.user.id, content]
        );

        res.status(201).json({ comment: rows[0] });
    } catch (err) {
        console.error("Create comment error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

/* ═══════════════════════════════════════════════════════════
   USER SOVEREIGNTY  — burn_at & scheduled_for controls
   ═══════════════════════════════════════════════════════════ */

// GET /api/user/posts — list current user's posts with timers
app.get("/api/user/posts", authRequired, async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT id, title, status, burn_at, burn_after, scheduled_for, is_draft, created_at, updated_at
       FROM posts WHERE author_id = $1 ORDER BY created_at DESC`,
            [req.user.id]
        );
        res.json({ posts: rows });
    } catch (err) {
        console.error("User posts error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// PATCH /api/user/posts/:id/burn — set or clear burn_at
app.patch("/api/user/posts/:id/burn", authRequired, async (req, res) => {
    try {
        const { burn_at } = req.body; // ISO string or null to clear

        const { rows: existing } = await query("SELECT author_id FROM posts WHERE id = $1", [req.params.id]);
        if (!existing.length) return res.status(404).json({ error: "Post not found" });
        if (existing[0].author_id !== req.user.id) return res.status(403).json({ error: "Not your post" });

        const { rows } = await query(
            "UPDATE posts SET burn_at = $1, updated_at = NOW() WHERE id = $2 RETURNING id, title, burn_at",
            [burn_at || null, req.params.id]
        );

        res.json({ post: rows[0], message: burn_at ? `Post will self-destruct at ${burn_at}` : "Burn timer cleared" });
    } catch (err) {
        console.error("Set burn error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// PATCH /api/user/posts/:id/schedule — set or clear scheduled_for
app.patch("/api/user/posts/:id/schedule", authRequired, async (req, res) => {
    try {
        const { scheduled_for } = req.body; // ISO string or null

        const { rows: existing } = await query("SELECT author_id FROM posts WHERE id = $1", [req.params.id]);
        if (!existing.length) return res.status(404).json({ error: "Post not found" });
        if (existing[0].author_id !== req.user.id) return res.status(403).json({ error: "Not your post" });

        const status = scheduled_for ? "scheduled" : "published";
        const { rows } = await query(
            "UPDATE posts SET scheduled_for = $1, status = $2, updated_at = NOW() WHERE id = $3 RETURNING id, title, scheduled_for, status",
            [scheduled_for || null, status, req.params.id]
        );

        res.json({ post: rows[0], message: scheduled_for ? `Post scheduled for ${scheduled_for}` : "Schedule cleared — post is now published" });
    } catch (err) {
        console.error("Set schedule error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/user/dashboard
app.get("/api/user/dashboard", authRequired, async (req, res) => {
    try {
        const { rows } = await query("SELECT * FROM v_user_dashboard WHERE id = $1", [req.user.id]);
        res.json({ dashboard: rows[0] || null });
    } catch (err) {
        console.error("User dashboard error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/user/notifications
app.get("/api/user/notifications", authRequired, async (req, res) => {
    try {
        const { rows } = await query(
            "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
            [req.user.id]
        );
        const { rows: unread } = await query(
            "SELECT unread_total FROM v_user_unread_counts WHERE user_id = $1",
            [req.user.id]
        );
        res.json({ notifications: rows, unread_total: parseInt(unread[0]?.unread_total || 0) });
    } catch (err) {
        console.error("Notifications error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// PATCH /api/user/notifications/:id/read
app.patch("/api/user/notifications/:id/read", authRequired, async (req, res) => {
    try {
        await query("UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
        res.json({ message: "Marked as read" });
    } catch (err) {
        console.error("Mark read error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/user/scheduled-tasks
app.get("/api/user/scheduled-tasks", authRequired, async (req, res) => {
    try {
        const { rows } = await query("SELECT * FROM v_scheduled_tasks WHERE author_id = $1", [req.user.id]);
        res.json({ tasks: rows });
    } catch (err) {
        console.error("Scheduled tasks error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

/* ═══════════════════════════════════════════════════════════
   REPORTS  (user-facing)
   ═══════════════════════════════════════════════════════════ */

// POST /api/reports — submit a report
app.post("/api/reports", authRequired, async (req, res) => {
    try {
        const { post_id, reason, details } = req.body;
        if (!post_id || !reason) return res.status(400).json({ error: "post_id and reason required" });

        const { rows } = await query(
            `INSERT INTO reports (id, reporter_id, post_id, reason, details, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW()) RETURNING *`,
            [uuidv4(), req.user.id, post_id, reason, details || null]
        );

        res.status(201).json({ report: rows[0] });
    } catch (err) {
        console.error("Report error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

/* ═══════════════════════════════════════════════════════════
   USER BLOCKS
   ═══════════════════════════════════════════════════════════ */

// POST /api/user/block/:userId
app.post("/api/user/block/:userId", authRequired, async (req, res) => {
    try {
        await query(
            `INSERT INTO user_blocks (blocker_id, blocked_id, created_at)
       VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
            [req.user.id, req.params.userId]
        );
        res.json({ message: "User blocked" });
    } catch (err) {
        console.error("Block error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// DELETE /api/user/block/:userId
app.delete("/api/user/block/:userId", authRequired, async (req, res) => {
    try {
        await query("DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2", [req.user.id, req.params.userId]);
        res.json({ message: "User unblocked" });
    } catch (err) {
        console.error("Unblock error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

/* ═══════════════════════════════════════════════════════════
   SEARCH ROUTES (Fuzzy pg_trgm)
   ═══════════════════════════════════════════════════════════ */

// GET /api/search/posts?q=query
app.get("/api/search/posts", async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json({ posts: [] });

        // Leveraging GIN pg_trgm indexes on title and content
        // Joining with users to get status orbs
        const { rows } = await query(
            `SELECT v.*, u.last_seen_at as author_last_seen_at, u.is_banned as author_is_banned 
             FROM v_main_feed v
             JOIN users u ON v.author_id = u.id
             WHERE v.title % $1 OR v.content % $1 
             ORDER BY similarity(v.title, $1) DESC LIMIT 50`,
            [q]
        );
        res.json({ posts: rows });
    } catch (err) {
        console.error("Search posts error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/search/users?q=query
app.get("/api/search/users", async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.json({ users: [] });

        // Fuzzy match on email/handle
        const { rows } = await query(
            `SELECT id, email, country, last_seen_at, is_banned, pfp_url
             FROM users 
             WHERE email % $1 
             ORDER BY similarity(email, $1) DESC LIMIT 20`,
            [q]
        );
        res.json({ users: rows });
    } catch (err) {
        console.error("Search users error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

/* ═══════════════════════════════════════════════════════════
   ██████   ██████  ██████      ███    ███  ██████  ██████  ███████
  ██       ██    ██ ██   ██     ████  ████ ██    ██ ██   ██ ██
  ██   ███ ██    ██ ██   ██     ██ ████ ██ ██    ██ ██   ██ █████
  ██    ██ ██    ██ ██   ██     ██  ██  ██ ██    ██ ██   ██ ██
   ██████   ██████  ██████      ██      ██  ██████  ██████  ███████

   ADMIN / GOD MODE  (all routes require authRequired + adminRequired)
   ═══════════════════════════════════════════════════════════ */

// GET /api/admin/stats — master stats from v_admin_master_stats
app.get("/api/admin/stats", authRequired, adminRequired, async (req, res) => {
    try {
        const { rows } = await query("SELECT * FROM v_admin_master_stats");
        res.json({ stats: rows[0] || {} });
    } catch (err) {
        console.error("Admin stats error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/admin/reports — report center from v_admin_report_center
app.get("/api/admin/reports", authRequired, adminRequired, async (req, res) => {
    try {
        const { status } = req.query;
        let sql = "SELECT * FROM v_admin_report_center";
        const params = [];
        if (status) {
            params.push(status);
            sql += " WHERE status = $1"; // The view might not have status, fall back to join
        }
        sql += " ORDER BY created_at DESC";
        const { rows } = await query(sql, params);
        res.json({ reports: rows });
    } catch (err) {
        console.error("Admin reports error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// PATCH /api/admin/reports/:id — resolve a report
app.patch("/api/admin/reports/:id", authRequired, adminRequired, async (req, res) => {
    try {
        const { status, admin_notes } = req.body;
        const { rows } = await query(
            "UPDATE reports SET status = $1, admin_notes = $2 WHERE id = $3 RETURNING *",
            [status || "reviewed", admin_notes || null, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: "Report not found" });

        // Log admin action
        await query(
            `INSERT INTO admin_actions (admin_id, action_performed, reason, target_post_id, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
            [req.user.id, `report_${status}`, admin_notes, rows[0].post_id, req.ip]
        );

        res.json({ report: rows[0] });
    } catch (err) {
        console.error("Resolve report error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// GET /api/admin/heat-map — roast heat map
app.get("/api/admin/heat-map", authRequired, adminRequired, async (req, res) => {
    try {
        const { rows } = await query("SELECT * FROM v_roast_heat_map");
        res.json({ heatMap: rows });
    } catch (err) {
        console.error("Heat map error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ── God Mode: Flag / Unflag a post ───────────────────────
app.patch("/api/admin/posts/:id/flag", authRequired, adminRequired, async (req, res) => {
    try {
        const { is_flagged, reason } = req.body;
        const { rows } = await query(
            "UPDATE posts SET is_flagged = $1, updated_at = NOW() WHERE id = $2 RETURNING id, title, is_flagged",
            [is_flagged ?? true, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: "Post not found" });

        await query(
            `INSERT INTO admin_actions (admin_id, action_performed, reason, target_post_id, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
            [req.user.id, is_flagged ? "flag_post" : "unflag_post", reason || null, req.params.id, req.ip]
        );

        res.json({ post: rows[0], message: is_flagged ? "Post flagged" : "Post unflagged" });
    } catch (err) {
        console.error("Flag error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ── God Mode: Lock / Unlock editing on a post ────────────
app.patch("/api/admin/posts/:id/edit-lock", authRequired, adminRequired, async (req, res) => {
    try {
        const { edit_locked, reason } = req.body;
        const { rows } = await query(
            "UPDATE posts SET edit_locked = $1, updated_at = NOW() WHERE id = $2 RETURNING id, title, edit_locked",
            [edit_locked ?? true, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: "Post not found" });

        await query(
            `INSERT INTO admin_actions (admin_id, action_performed, reason, target_post_id, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
            [req.user.id, edit_locked ? "lock_edit" : "unlock_edit", reason || null, req.params.id, req.ip]
        );

        res.json({ post: rows[0] });
    } catch (err) {
        console.error("Edit lock error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ── God Mode: Force-delete any post ──────────────────────
app.delete("/api/admin/posts/:id", authRequired, adminRequired, async (req, res) => {
    try {
        const { reason } = req.body;
        const { rows } = await query("SELECT id, title FROM posts WHERE id = $1", [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: "Post not found" });

        await query("DELETE FROM posts WHERE id = $1", [req.params.id]);

        await query(
            `INSERT INTO admin_actions (admin_id, action_performed, reason, target_post_id, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
            [req.user.id, "force_delete_post", reason || "No reason provided", req.params.id, req.ip]
        );

        res.json({ message: `Post "${rows[0].title}" force-deleted` });
    } catch (err) {
        console.error("Force delete error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ── God Mode: Shadow-ban a user ──────────────────────────
app.patch("/api/admin/users/:id/shadow-ban", authRequired, adminRequired, async (req, res) => {
    try {
        const { is_shadow_banned, reason } = req.body;
        const { rows } = await query(
            "UPDATE users SET is_shadow_banned = $1 WHERE id = $2 RETURNING id, email, is_shadow_banned",
            [is_shadow_banned ?? true, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: "User not found" });

        await query(
            `INSERT INTO admin_actions (admin_id, action_performed, reason, target_user_id, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
            [req.user.id, is_shadow_banned ? "shadow_ban" : "remove_shadow_ban", reason || null, req.params.id, req.ip]
        );

        res.json({ user: rows[0] });
    } catch (err) {
        console.error("Shadow ban error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ── God Mode: Restrict a user ────────────────────────────
app.post("/api/admin/users/:id/restrict", authRequired, adminRequired, async (req, res) => {
    try {
        const { restriction_scope, reason, expires_at } = req.body;

        const { rows } = await query(
            `INSERT INTO user_restrictions (user_id, admin_id, restriction_scope, reason, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
            [req.params.id, req.user.id, restriction_scope || "full", reason || null, expires_at || null]
        );

        await query(
            `INSERT INTO admin_actions (admin_id, action_performed, reason, target_user_id, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
            [req.user.id, "restrict_user", reason, req.params.id, req.ip]
        );

        res.json({ restriction: rows[0] });
    } catch (err) {
        console.error("Restrict error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ── God Mode: Remove a restriction ──────────────────────
app.delete("/api/admin/restrictions/:id", authRequired, adminRequired, async (req, res) => {
    try {
        const { rows } = await query("DELETE FROM user_restrictions WHERE id = $1 RETURNING *", [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: "Restriction not found" });

        await query(
            `INSERT INTO admin_actions (admin_id, action_performed, reason, target_user_id, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
            [req.user.id, "remove_restriction", "Restriction lifted", rows[0].user_id, req.ip]
        );

        res.json({ message: "Restriction removed" });
    } catch (err) {
        console.error("Remove restriction error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ── God Mode: Verify / Un-verify a user ─────────────────
app.patch("/api/admin/users/:id/verify", authRequired, adminRequired, async (req, res) => {
    try {
        const { is_verified } = req.body;
        const { rows } = await query(
            "UPDATE users SET is_verified = $1 WHERE id = $2 RETURNING id, email, is_verified",
            [is_verified ?? true, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: "User not found" });

        await query(
            `INSERT INTO admin_actions (admin_id, action_performed, reason, target_user_id, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
            [req.user.id, is_verified ? "verify_user" : "unverify_user", null, req.params.id, req.ip]
        );

        res.json({ user: rows[0] });
    } catch (err) {
        console.error("Verify error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ── God Mode: Ban / Un-ban a user ───────────────────────
app.patch("/api/admin/users/:id/ban", authRequired, adminRequired, async (req, res) => {
    try {
        const { is_banned, reason } = req.body;
        const { rows } = await query(
            "UPDATE users SET is_banned = $1 WHERE id = $2 RETURNING id, email, is_banned",
            [is_banned ?? true, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: "User not found" });

        await query(
            `INSERT INTO admin_actions (admin_id, action_performed, reason, target_user_id, ip_address, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
            [req.user.id, is_banned ? "ban_user" : "unban_user", reason || "No reason", req.params.id, req.ip]
        );

        res.json({ user: rows[0], message: is_banned ? "User account suspended" : "User account reinstated" });
    } catch (err) {
        console.error("Ban error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ── God Mode: List all users ────────────────────────────
app.get("/api/admin/users", authRequired, adminRequired, async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
        const offset = (page - 1) * limit;

        // Use the new User Control Center view for advanced metrics
        const { rows } = await query(
            `SELECT * FROM v_admin_user_control_center 
             ORDER BY report_count DESC, last_seen_at DESC 
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        const countRes = await query("SELECT COUNT(*) FROM users");
        const total = parseInt(countRes.rows[0].count);

        res.json({
            users: rows,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (err) {
        console.error("Admin user list error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ── God Mode: View admin action log ─────────────────────
app.get("/api/admin/actions", authRequired, adminRequired, async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT aa.*, u.email AS admin_email
       FROM admin_actions aa
       LEFT JOIN users u ON aa.admin_id = u.id
       ORDER BY aa.created_at DESC LIMIT 100`
        );
        res.json({ actions: rows });
    } catch (err) {
        console.error("Admin actions error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// ── God Mode: Security audit log ────────────────────────
app.get("/api/admin/audit", authRequired, adminRequired, async (req, res) => {
    try {
        const { rows } = await query(
            "SELECT * FROM security_audit ORDER BY created_at DESC LIMIT 200"
        );
        res.json({ audit: rows });
    } catch (err) {
        console.error("Audit log error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

/* ═══════════════════════════════════════════════════════════
   BADGES
   ═══════════════════════════════════════════════════════════ */
app.get("/api/user/badges", authRequired, async (req, res) => {
    try {
        const { rows } = await query("SELECT * FROM badges WHERE user_id = $1 ORDER BY achieved_at DESC", [req.user.id]);
        res.json({ badges: rows });
    } catch (err) {
        console.error("Badges error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

/* ═══════════════════════════════════════════════════════════
   HEALTH CHECK
   ═══════════════════════════════════════════════════════════ */
app.get("/api/health", async (_req, res) => {
    try {
        await query("SELECT 1");
        res.json({ status: "ok", timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ status: "db_error", error: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════
   START
   ═══════════════════════════════════════════════════════════ */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`\n🍩  Roast & Donut API running on http://localhost:${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || "development"}\n`);
});
