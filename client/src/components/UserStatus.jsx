/* ═══════════════════════════════════════════════════════════
   UserStatus.jsx — Roast & Donut
   Standard: Status Orbs
   Logic: Online (🟢), Offline (⚪), Blocked (⚫), Banned (🟡)
   ═══════════════════════════════════════════════════════════ */

import React from 'react';
import { formatDistanceToNow } from 'date-fns';

const UserStatus = ({ last_seen_at, is_banned, is_blocked }) => {
    // 1. Determine the status logic
    const lastSeen = new Date(last_seen_at);
    const now = new Date();
    const diffMinutes = (now - lastSeen) / 1000 / 60;

    let status = 'offline';
    let dotClass = 'dot-offline';
    let statusText = `Online ${formatDistanceToNow(lastSeen, { addSuffix: true })}`;

    if (is_banned) {
        status = 'banned';
        dotClass = 'dot-banned';
        statusText = 'Account Suspended';
    } else if (is_blocked) {
        status = 'blocked';
        dotClass = 'dot-blocked';
        statusText = 'User Blocked';
    } else if (diffMinutes <= 5) {
        status = 'online';
        dotClass = 'dot-online';
        statusText = 'Online';
    }

    return (
        <div className="rd-user-status" style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span className={`status-dot ${dotClass}`} title={statusText}></span>
            <span className="status-text">{statusText}</span>
        </div>
    );
};

export default UserStatus;
