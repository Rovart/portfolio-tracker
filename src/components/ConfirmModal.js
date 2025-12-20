'use client';

import { useEffect } from 'react';

export default function ConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    title = 'Confirm Action',
    message = 'Are you sure you want to proceed?',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    confirmStyle = 'danger' // 'danger' or 'primary'
}) {
    // Handle escape key
    useEffect(() => {
        if (!isOpen) return;

        const handleEscape = (e) => {
            if (e.key === 'Escape') onClose();
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    // Handle Android back button
    useEffect(() => {
        if (!isOpen) return;

        let backButtonListener = null;

        const setupBackButton = async () => {
            try {
                const { App } = await import('@capacitor/app');
                backButtonListener = await App.addListener('backButton', () => {
                    onClose();
                });
            } catch (e) {
                // Capacitor not available
            }
        };

        setupBackButton();

        return () => {
            if (backButtonListener) backButtonListener.remove();
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const confirmColors = confirmStyle === 'danger'
        ? { bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.3)', text: '#ef4444', hoverBg: 'rgba(239, 68, 68, 0.25)' }
        : { bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.3)', text: '#3b82f6', hoverBg: 'rgba(59, 130, 246, 0.25)' };

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.8)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
                padding: '20px'
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                style={{
                    background: 'linear-gradient(145deg, rgba(30, 30, 30, 0.98), rgba(20, 20, 20, 0.98))',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '20px',
                    padding: '28px',
                    maxWidth: '400px',
                    width: '100%',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                }}
            >
                {/* Title */}
                <h3 style={{
                    fontSize: '1.25rem',
                    fontWeight: '600',
                    color: 'white',
                    marginBottom: '12px',
                    textAlign: 'center'
                }}>
                    {title}
                </h3>

                {/* Message */}
                <p style={{
                    fontSize: '0.95rem',
                    color: 'rgba(255, 255, 255, 0.7)',
                    marginBottom: '24px',
                    textAlign: 'center',
                    lineHeight: '1.5'
                }}>
                    {message}
                </p>

                {/* Buttons */}
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        onClick={onClose}
                        style={{
                            flex: 1,
                            padding: '14px 20px',
                            borderRadius: '12px',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            background: 'rgba(255, 255, 255, 0.05)',
                            color: 'rgba(255, 255, 255, 0.8)',
                            fontSize: '0.9rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                        }}
                        onMouseOver={(e) => {
                            e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                        }}
                        onMouseOut={(e) => {
                            e.target.style.background = 'rgba(255, 255, 255, 0.05)';
                        }}
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={() => {
                            onConfirm();
                            onClose();
                        }}
                        style={{
                            flex: 1,
                            padding: '14px 20px',
                            borderRadius: '12px',
                            border: `1px solid ${confirmColors.border}`,
                            background: confirmColors.bg,
                            color: confirmColors.text,
                            fontSize: '0.9rem',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                        }}
                        onMouseOver={(e) => {
                            e.target.style.background = confirmColors.hoverBg;
                        }}
                        onMouseOut={(e) => {
                            e.target.style.background = confirmColors.bg;
                        }}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
