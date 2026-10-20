import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { AlertTriangleIcon } from '../components/ui/Icons';

export const NotFoundPage: React.FC = () => {
  return (
    <main className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4 py-12 text-txt-primary">
      <div className="w-16 h-16 rounded-2xl bg-elevated border border-border text-txt-secondary flex items-center justify-center shadow-card mb-4">
        <AlertTriangleIcon className="w-8 h-8 text-txt-muted" />
      </div>
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-txt-primary mb-2">
        Page Not Found (404)
      </h1>
      <p className="text-txt-secondary max-w-md mb-6 text-sm leading-relaxed">
        The requested control plane URL does not exist or has been relocated.
      </p>
      <Link to="/servers">
        <Button variant="primary">Return to Dashboard</Button>
      </Link>
    </main>
  );
};
