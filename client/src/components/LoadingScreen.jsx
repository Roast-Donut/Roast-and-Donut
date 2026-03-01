/* ═══════════════════════════════════════════════════════════
   LoadingScreen.jsx — Roast & Donut
   Standard: Blueprint Sequence (Bento skeletons + progress line).
   Triggers on fetches from v_main_feed, v_trending_feed, etc.
   ═══════════════════════════════════════════════════════════ */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const LoadingScreen = ({ isLoading }) => {
    return (
        <AnimatePresence>
            {isLoading && (
                <motion.div
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0, y: -20 }} // Slides up and out
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    className="blueprint-overlay"
                >
                    {/* Top Progress Line */}
                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: '100%' }}
                        className="loading-bar"
                    />

                    {/* Minimalist Text */}
                    <motion.p
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ repeat: Infinity, duration: 2 }}
                        className="loading-text"
                    >
                        Synchronizing with Neon Engine...
                    </motion.p>

                    {/* Subtle Blueprint Grid Hint */}
                    <div style={{ marginTop: '32px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', width: '256px', opacity: 0.2 }}>
                        <div className="skeleton-card" style={{ height: '48px' }} />
                        <div className="skeleton-card" style={{ height: '48px' }} />
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default LoadingScreen;
