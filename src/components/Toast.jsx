import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

const ToastContext = createContext(null);

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((toast) => {
    const id = ++toastId;
    const newToast = {
      id,
      type: toast.type || 'info',
      title: toast.title || '',
      description: toast.description || '',
      duration: toast.duration ?? (toast.type === 'error' ? 6500 : 4200),
      action: toast.action || null,
      onAction: toast.onAction || null,
      persistent: !!toast.persistent,
    };

    setToasts((prev) => [...prev, newToast]);

    // Auto dismiss (unless persistent)
    if (!newToast.persistent && newToast.duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, newToast.duration);
    }

    return id;
  }, [removeToast]);

  const toast = {
    success: (title, opts = {}) => addToast({ type: 'success', title, ...opts }),
    error: (title, opts = {}) => addToast({ type: 'error', title, ...opts }),
    info: (title, opts = {}) => addToast({ type: 'info', title, ...opts }),
    warning: (title, opts = {}) => addToast({ type: 'warning', title, ...opts }),
    // For advanced usage (copy with "Copied!" feedback etc.)
    custom: (opts) => addToast(opts),
    dismiss: (id) => removeToast(id),
    dismissAll: () => setToasts([]),
  };

  return (
    <ToastContext.Provider value={{ toast, toasts, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context.toast;
}

// Visual toast container + individual toasts
function ToastContainer({ toasts, onDismiss }) {
  if (!toasts.length) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 w-full max-w-[420px] px-3 pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  const { id, type, title, description, action, onAction, persistent } = toast;

  const colors = {
    success: {
      border: 'border-emerald-500/70',
      bg: 'bg-zinc-900',
      icon: 'text-emerald-400',
      accent: 'bg-emerald-500',
    },
    error: {
      border: 'border-red-500/70',
      bg: 'bg-zinc-900',
      icon: 'text-red-400',
      accent: 'bg-red-500',
    },
    warning: {
      border: 'border-amber-500/70',
      bg: 'bg-zinc-900',
      icon: 'text-amber-400',
      accent: 'bg-amber-500',
    },
    info: {
      border: 'border-sky-500/70',
      bg: 'bg-zinc-900',
      icon: 'text-sky-400',
      accent: 'bg-sky-500',
    },
  }[type] || {
    border: 'border-zinc-600',
    bg: 'bg-zinc-900',
    icon: 'text-zinc-400',
    accent: 'bg-zinc-500',
  };

  const icons = {
    success: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
    ),
    warning: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
      </svg>
    ),
    info: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
      </svg>
    ),
  };

  const handleAction = () => {
    if (onAction) {
      onAction();
    }
    onDismiss();
  };

  return (
    <div
      className={`pointer-events-auto w-full max-w-[420px] ${colors.bg} border ${colors.border} rounded-2xl shadow-2xl shadow-black/40 overflow-hidden flex flex-col animate-[toastSlideIn_0.2s_cubic-bezier(0.32,0.72,0,1)]`}
      role="alert"
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <div className={`mt-0.5 flex-shrink-0 ${colors.icon}`}>
          {icons[type] || icons.info}
        </div>

        <div className="flex-1 min-w-0 pt-0.5">
          {title && (
            <div className="font-semibold text-white text-[15px] leading-tight tracking-[-0.1px]">
              {title}
            </div>
          )}
          {description && (
            <div className="mt-1 text-sm text-zinc-300 leading-snug break-words">
              {description}
            </div>
          )}

          {action && onAction && (
            <button
              onClick={handleAction}
              className="mt-2.5 text-sm font-semibold text-orange-400 hover:text-orange-300 active:text-orange-500 transition-colors"
            >
              {action}
            </button>
          )}
        </div>

        <button
          onClick={onDismiss}
          className="flex-shrink-0 mt-0.5 p-1 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Dismiss notification"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Subtle progress bar for auto-dismiss feel */}
      {!persistent && (
        <div className="h-px w-full bg-white/10 overflow-hidden">
          <div
            className={`h-full ${colors.accent} opacity-60 animate-[toastProgress_${toast.duration}ms_linear_forwards]`}
            style={{ animationDuration: `${toast.duration}ms` }}
          />
        </div>
      )}
    </div>
  );
}

// Add the required keyframes to global styles (injected once)
if (typeof document !== 'undefined' && !document.getElementById('toast-keyframes')) {
  const style = document.createElement('style');
  style.id = 'toast-keyframes';
  style.textContent = `
    @keyframes toastSlideIn {
      from {
        opacity: 0;
        transform: translateY(-12px) scale(0.985);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }
    @keyframes toastProgress {
      from { width: 100%; }
      to { width: 0%; }
    }
  `;
  document.head.appendChild(style);
}
