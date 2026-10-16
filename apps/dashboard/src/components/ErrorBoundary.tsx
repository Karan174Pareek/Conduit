import { Component, ErrorInfo, ReactNode } from 'react';
import { ApiError } from '../api/client';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in dashboard:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const error = this.state.error;
      const isApiError = error instanceof ApiError;
      const requestId = isApiError ? (error as ApiError).requestId : undefined;

      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-center">
          <div className="max-w-md w-full p-6 bg-slate-900 border border-rose-900/50 rounded-lg shadow-xl">
            <div className="w-12 h-12 rounded-full bg-rose-950/60 border border-rose-800 text-rose-400 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
            <p className="text-slate-400 text-sm mb-4">
              {error?.message || 'An unexpected error occurred while rendering this view.'}
            </p>
            {requestId && (
              <div className="mb-6 p-2 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-slate-400">
                Request ID: {requestId}
              </div>
            )}
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-md text-sm font-medium transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
