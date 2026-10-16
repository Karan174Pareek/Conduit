import React, { createContext, useContext, useState, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  requestId?: string;
}

export interface ToastContextValue {
  showToast: (message: string, type?: ToastType, requestId?: string) => void;
  addToast: (message: string, type?: ToastType, requestId?: string) => void;
  error: (message: string, requestId?: string) => void;
  success: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', requestId?: string) => {
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev, { id, type, message, requestId }]);

      setTimeout(() => {
        removeToast(id);
      }, 5000);
    },
    [removeToast],
  );

  const error = useCallback(
    (message: string, requestId?: string) => showToast(message, 'error', requestId),
    [showToast],
  );

  const success = useCallback(
    (message: string) => showToast(message, 'success'),
    [showToast],
  );

  return (
    <ToastContext.Provider value={{ showToast, addToast: showToast, error, success }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-lg shadow-lg border text-sm flex items-start justify-between transition-all ${
              toast.type === 'error'
                ? 'bg-rose-950 border-rose-800 text-rose-200'
                : toast.type === 'success'
                ? 'bg-emerald-950 border-emerald-800 text-emerald-200'
                : 'bg-slate-800 border-slate-700 text-slate-200'
            }`}
          >
            <div className="flex-1 pr-2">
              <p className="font-medium">{toast.message}</p>
              {toast.requestId && (
                <p className="text-xs opacity-75 mt-1 font-mono">Req ID: {toast.requestId}</p>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-current opacity-70 hover:opacity-100 p-0.5"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};
