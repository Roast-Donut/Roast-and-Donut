/* ═══════════════════════════════════════════════════════════
   ErrorTooltip.jsx — Roast & Donut
   Standard: 3D Obsidian Glass physical object.
   Mapped to: failed_attempts, locked_until, birthdate, burn_at, etc.
   ═══════════════════════════════════════════════════════════ */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const ErrorTooltip = ({ errorType, triggerCount = 0 }) => {
    const [isShaking, setIsShaking] = useState(false);

    // Mapping the database-driven error messages to "System Truths"
    const errorMap = {
        AUTH_FAILED: "Credentials not recognized by the engine.",
        SECURITY_LOCKOUT: "Security threshold reached. Access is temporarily suspended.", // failed_attempts
        COOLDOWN: "System cooling down. Please wait until the timer expires.",        // locked_until
        AGE_GATE: "Access restricted. Valid 21+ identification required.",            // birthdate
        BURN_EXPIRED: "The roast you are looking for has already self-destructed.",    // burn_at
        SHADOW_BAN: "Connection timeout. Please refresh your session.",               // is_shadow_banned (Vague)
        RESTRICTED: "Your account permissions are currently limited by an admin.",     // restriction_scope
        GENERIC: "Something went wrong. The engine is resetting."
    };

    const message = errorMap[errorType] || errorMap.GENERIC;

    // Trigger the 3D tilt-shake if the user attempts the same error again
    useEffect(() => {
        if (triggerCount > 0) {
            setIsShaking(true);
            const timer = setTimeout(() => setIsShaking(false), 400);
            return () => clearTimeout(timer);
        }
    }, [triggerCount]);

    return (
        <AnimatePresence>
            {errorType && (
                <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10, rotateX: 10 }}
                    animate={{
                        opacity: 1,
                        scale: 1,
                        y: 0,
                        rotateX: 0
                    }}
                    exit={{ opacity: 0, scale: 0.95, y: 5 }}
                    className={`error-tooltip ${isShaking ? 'shake' : ''}`}
                    style={{ position: 'fixed', bottom: '40px', left: '50%', translateX: '-50%', zIndex: 9999 }}
                >
                    <div className="tooltip-content">
                        {message}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default ErrorTooltip;
