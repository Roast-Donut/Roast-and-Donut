/* ═══════════════════════════════════════════════════════════
   MainFeed.jsx  —  Roast & Donut
   Main + Trending feed with category filtering.
   Pulls from:
     GET /api/feed/main
     GET /api/feed/trending
     GET /api/feed/categories
     POST /api/posts/:id/interact
   ═══════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import LoadingScreen from "./LoadingScreen";
import UserStatus from "./UserStatus";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

/* ── tiny helpers ─────────────────────────────────────────── */
function getToken() {
    return localStorage.getItem("rd_token");
}

function authHeaders() {
    const t = getToken();
    return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function api(path, opts = {}) {
    const res = await fetch(`${API}${path}`, { ...opts, headers: { ...authHeaders(), ...opts.headers } });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json();
}

/* ── PostCard ─────────────────────────────────────────────── */
function PostCard({ post, onInteract }) {
    const [busy, setBusy] = useState(false);

    async function interact(payload) {
        if (busy || !getToken()) return;
        setBusy(true);
        try {
            await api(`/api/posts/${post.post_id}/interact`, {
                method: "POST",
                body: JSON.stringify(payload),
            });
            onInteract?.();
        } catch (err) {
            console.error("Interact failed:", err.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="rd-post-card">
            {/* Cover image */}
            {post.cover_image_url && (
                <div className="rd-post-cover">
                    <img src={post.cover_image_url} alt={post.title} loading="lazy" />
                </div>
            )}

            {/* Header */}
            <div className="rd-post-header">
                <img
                    className="rd-avatar"
                    src={post.author_avatar || `https://api.dicebear.com/7.x/thumbs/svg?seed=${post.author_id}`}
                    alt={post.author_name}
                />
                <div className="rd-post-meta">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="rd-author-name">{post.author_name || "Anonymous"}</span>
                        <UserStatus
                            last_seen_at={post.author_last_seen_at}
                            is_banned={post.author_is_banned}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {post.author_country && <span className="rd-country-badge">{post.author_country}</span>}
                        <span className="rd-time">{post.time_display || new Date(post.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
                {post.category && <span className="rd-category-pill">{post.category}</span>}
            </div>

            {/* Body */}
            <h3 className="rd-post-title">{post.title}</h3>
            <p className="rd-post-body">{post.content}</p>

            {/* Stats bar (only when show_stats is true) */}
            {post.show_stats !== false && (
                <div className="rd-stats-bar">
                    {post.avg_stars != null && (
                        <span className="rd-stat" title="Average rating">
                            ⭐ {Number(post.avg_stars).toFixed(1)}
                        </span>
                    )}
                    {post.comment_count != null && (
                        <span className="rd-stat">💬 {post.comment_count}</span>
                    )}
                    {post.share_count != null && (
                        <span className="rd-stat">🔗 {post.share_count}</span>
                    )}
                    {post.dislikes != null && (
                        <span className="rd-stat">👎 {post.dislikes}</span>
                    )}
                    {post.heat_index != null && (
                        <span className="rd-stat rd-heat" title="Heat index">
                            🔥 {Number(post.heat_index).toFixed(1)}
                        </span>
                    )}
                </div>
            )}

            {/* Actions */}
            <div className="rd-actions">
                <button
                    className="rd-btn rd-btn-like"
                    disabled={busy}
                    onClick={() => interact({ is_dislike: false, rating: 5 })}
                    title="Like"
                >
                    👍
                </button>
                <button
                    className="rd-btn rd-btn-dislike"
                    disabled={busy}
                    onClick={() => interact({ is_dislike: true })}
                    title="Dislike"
                >
                    👎
                </button>
                <button
                    className="rd-btn rd-btn-share"
                    disabled={busy}
                    onClick={() => interact({ is_shared: true })}
                    title="Share"
                >
                    🔗 Share
                </button>
            </div>
        </div>
    );
}

/* ── Pagination ───────────────────────────────────────────── */
function Pagination({ pagination, onPageChange }) {
    if (!pagination || pagination.totalPages <= 1) return null;
    const { page, totalPages, total } = pagination;

    return (
        <div className="rd-pagination">
            <button
                className="rd-btn rd-btn-page"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
            >
                ← Prev
            </button>
            <span className="rd-page-info">
                Page {page} of {totalPages} &middot; {total} posts
            </span>
            <button
                className="rd-btn rd-btn-page"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
            >
                Next →
            </button>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════
   MainFeed  (default export)
   ═══════════════════════════════════════════════════════════ */
/* ── UserCard ─────────────────────────────────────────────── */
function UserCard({ user }) {
    return (
        <div className="rd-user-card">
            <img
                className="rd-avatar"
                src={user.pfp_url || `https://api.dicebear.com/7.x/thumbs/svg?seed=${user.id}`}
                alt={user.email}
            />
            <div className="rd-user-info">
                <span className="rd-user-email">{user.email}</span>
                <UserStatus last_seen_at={user.last_seen_at} is_banned={user.is_banned} />
                {user.country && <span className="rd-country-badge">{user.country}</span>}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════
   MainFeed  (default export)
   ═══════════════════════════════════════════════════════════ */
export default function MainFeed() {
    /* ── state ──────────── */
    const [tab, setTab] = useState("main");           // "main" | "trending" | "search"
    const [posts, setPosts] = useState([]);
    const [users, setUsers] = useState([]);           // Fuzzy user search results
    const [pagination, setPagination] = useState(null);
    const [categories, setCategories] = useState([]);
    const [activeCategory, setActiveCategory] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [dailyWinner, setDailyWinner] = useState(null);

    /* ── fetch categories once ─── */
    useEffect(() => {
        api("/api/feed/categories")
            .then((d) => setCategories(d.categories || []))
            .catch(() => { });

        api("/api/feed/daily-winner")
            .then((d) => setDailyWinner(d.winner))
            .catch(() => { });
    }, []);

    /* ── fetch feed ─────── */
    const fetchFeed = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            if (tab === "search") {
                if (!searchQuery) {
                    setPosts([]);
                    setUsers([]);
                    setLoading(false);
                    return;
                }
                // Fetch posts and users in parallel for fuzzy search
                const [postData, userData] = await Promise.all([
                    api(`/api/search/posts?q=${encodeURIComponent(searchQuery)}`),
                    api(`/api/search/users?q=${encodeURIComponent(searchQuery)}`)
                ]);
                setPosts(postData.posts || []);
                setUsers(userData.users || []);
                setPagination(null); // Search usually isn't paged standardly here
            } else {
                const endpoint = tab === "trending" ? "/api/feed/trending" : "/api/feed/main";
                const params = new URLSearchParams({ page, limit: 20 });
                if (activeCategory) params.set("category", activeCategory);

                const data = await api(`${endpoint}?${params}`);
                setPosts(data.posts || []);
                setUsers([]);
                setPagination(data.pagination || null);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [tab, page, activeCategory, searchQuery]);

    useEffect(() => {
        // Debounce search
        if (tab === "search") {
            const timer = setTimeout(() => {
                fetchFeed();
            }, 300);
            return () => clearTimeout(timer);
        } else {
            fetchFeed();
        }
    }, [fetchFeed, tab]);

    /* ── handlers ───────── */
    function handleTabChange(newTab) {
        setTab(newTab);
        setPage(1);
    }

    function handleCategoryChange(cat) {
        setActiveCategory(cat);
        setPage(1);
        if (tab === "search") setTab("main"); // Exit search if filtering by category typically
    }

    /* ── render ─────────── */
    return (
        <section className="rd-feed-wrapper">
            {/* ── Daily Roast Winner Banner ─── */}
            {dailyWinner && tab !== "search" && (
                <div className="rd-winner-banner">
                    <span className="rd-winner-icon">🏆</span>
                    <div>
                        <strong>Daily Roast Winner</strong>
                        <p>
                            &ldquo;{dailyWinner.title}&rdquo; by {dailyWinner.author_name} &middot;
                            Engagement Score: {dailyWinner.engagement_score}
                        </p>
                    </div>
                </div>
            )}

            {/* ── Search Bar ─── */}
            <div className="rd-search-container">
                <input
                    type="text"
                    className="rd-search-input"
                    placeholder="Fuzzy search posts or users..."
                    value={searchQuery}
                    onChange={(e) => {
                        setSearchQuery(e.target.value);
                        if (tab !== "search") setTab("search");
                    }}
                />
                {searchQuery && (
                    <button className="rd-search-clear" onClick={() => { setSearchQuery(""); setTab("main"); }}>
                        ✕
                    </button>
                )}
            </div>

            {/* ── Tab switcher ─── */}
            <div className="rd-tab-bar">
                <button
                    className={`rd-tab ${tab === "main" ? "rd-tab-active" : ""}`}
                    onClick={() => handleTabChange("main")}
                >
                    🍩 Main Feed
                </button>
                <button
                    className={`rd-tab ${tab === "trending" ? "rd-tab-active" : ""}`}
                    onClick={() => handleTabChange("trending")}
                >
                    🔥 Trending
                </button>
                {tab === "search" && (
                    <button className="rd-tab rd-tab-active">
                        🔍 Search Results
                    </button>
                )}
            </div>

            {/* ── Category filter ─── */}
            {tab !== "search" && (
                <div className="rd-filter-bar">
                    <button
                        className={`rd-filter-chip ${activeCategory === "" ? "rd-filter-active" : ""}`}
                        onClick={() => handleCategoryChange("")}
                    >
                        All
                    </button>
                    {categories.map((cat) => (
                        <button
                            key={cat}
                            className={`rd-filter-chip ${activeCategory === cat ? "rd-filter-active" : ""}`}
                            onClick={() => handleCategoryChange(cat)}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            )}

            {/* ── Error state ─── */}
            {error && (
                <div className="rd-error">
                    <p>⚠️ {error}</p>
                    <button className="rd-btn" onClick={fetchFeed}>
                        Retry
                    </button>
                </div>
            )}


            {/* ── Blueprint Loading Screen ─── */}
            <LoadingScreen isLoading={loading && posts.length === 0} />

            {/* ── Results ─── */}
            {!error && (
                <div className="rd-results-container">
                    {/* User Results (only in search) */}
                    {tab === "search" && users.length > 0 && !loading && (
                        <div className="rd-user-results">
                            <h4 className="rd-section-title">Users</h4>
                            <div className="rd-user-grid">
                                {users.map(user => <UserCard key={user.id} user={user} />)}
                            </div>
                        </div>
                    )}

                    {/* Post Results or Skeletons */}
                    <div className="rd-post-list">
                        {tab === "search" && posts.length > 0 && <h4 className="rd-section-title">Posts</h4>}

                        {loading ? (
                            // Blueprint Skeletons while loading
                            Array.from({ length: 6 }).map((_, i) => (
                                <div key={`skeleton-${i}`} className="skeleton-card" style={{ marginBottom: '16px' }} />
                            ))
                        ) : (
                            // Actual Content with Cross-fade
                            posts.length === 0 ? (
                                <div className="rd-empty">
                                    <p>No posts found{activeCategory && tab !== "search" ? ` in "${activeCategory}"` : ""}.</p>
                                </div>
                            ) : (
                                posts.map((post) => (
                                    <motion.div
                                        key={post.post_id || post.id}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.3 }}
                                    >
                                        <PostCard post={post} onInteract={fetchFeed} />
                                    </motion.div>
                                ))
                            )
                        )}
                    </div>

                    {tab !== "search" && posts.length > 0 && !loading && (
                        <Pagination pagination={pagination} onPageChange={setPage} />
                    )}
                </div>
            )}
        </section>
    );
}
