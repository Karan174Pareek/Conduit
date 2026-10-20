import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { ShieldIcon } from '../components/ui/Icons';

export const ForbiddenPage: React.FC = () => {
  return (
    <main className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4 py-12 text-txt-primary">
      <div className="w-16 h-16 rounded-2xl bg-status-warning-bg border border-status-warning-border text-status-warning-text flex items-center justify-center shadow-card mb-4">
        <ShieldIcon className="w-8 h-8" />
      </div>
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-txt-primary mb-2">
        Access Forbidden (403)
      </h1>
      <p className="text-txt-secondary max-w-md mb-6 text-sm leading-relaxed">
        You do not have permission to access this resource. This area requires administrative privileges.
      </p>
      <div className="flex items-center gap-3">
        <Link to="/servers">
          <Button variant="primary">Back to Servers</Button>
        </Link>
        <Link to="/connect">
          <Button variant="secondary">Connect Client</Button>
        </Link>
      </div>
    </main>
  );
};
