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

    return (
        <div
            className="animate-overlay"
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.7)',
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
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirm-title"
                aria-describedby="confirm-message"
                className="alert animate-dialog"
            >
                <div className="alert-body">
                    <h3 id="confirm-title" className="alert-title">{title}</h3>
                    <p id="confirm-message" className="alert-message">{message}</p>
                </div>
                <div className="alert-actions">
                    <button type="button" onClick={onClose} className="alert-action">{cancelText}</button>
                    <button
                        type="button"
                        onClick={() => {
                            onConfirm();
                            onClose();
                        }}
                        className={`alert-action is-primary${confirmStyle === 'danger' ? ' is-danger' : ''}`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
