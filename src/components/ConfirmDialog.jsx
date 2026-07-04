import React from 'react';

/**
 * Simple, reusable confirmation dialog.
 * Matches the dark wallet aesthetic.
 */
export default function ConfirmDialog({
  open,
  title = 'Confirm Action',
  message,
  extra,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmVariant = 'danger', // 'danger' | 'primary'
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  const confirmClasses =
    confirmVariant === 'danger'
      ? 'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white'
      : 'bg-[#E79300] hover:bg-[#c47d00] active:bg-[#a66800] text-white';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-md rounded-3xl bg-zinc-900 border border-zinc-700 shadow-2xl overflow-hidden animate-[toastSlideIn_0.2s_cubic-bezier(0.32,0.72,0,1)]">
        <div className="px-6 pt-6 pb-5">
          <div className="text-lg font-semibold text-white tracking-[-0.2px]">{title}</div>
          {message && (
            <div className="mt-3 text-sm leading-relaxed text-zinc-300 whitespace-pre-line">
              {message}
            </div>
          )}
          {extra}
        </div>

        <div className="flex gap-3 p-4 border-t border-zinc-800 bg-zinc-900">
          <button
            onClick={onCancel}
            className="flex-1 py-3 text-sm font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-950 rounded-2xl border border-zinc-700 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-3 text-sm font-semibold rounded-2xl transition-colors ${confirmClasses}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
