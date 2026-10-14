import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';

export const ForbiddenPage: React.FC = () => {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <div className="w-16 h-16 rounded-full bg-amber-950/60 border border-amber-800 text-amber-400 flex items-center justify-center text-2xl font-bold mb-4">
        403
      </div>
      <h1 className="text-2xl font-bold text-white mb-2">Access Forbidden</h1>
      <p className="text-slate-400 max-w-md mb-6 text-sm">
        You do not have permission to access this resource. This page requires administrator privileges.
      </p>
      <Link to="/servers">
        <Button variant="secondary">Back to Servers</Button>
      </Link>
    </div>
  );
};
