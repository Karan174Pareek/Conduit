import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <div className="w-16 h-16 rounded-full bg-slate-800 border border-slate-700 text-slate-400 flex items-center justify-center text-2xl font-bold mb-4">
        404
      </div>
      <h1 className="text-2xl font-bold text-white mb-2">Page Not Found</h1>
      <p className="text-slate-400 max-w-md mb-6 text-sm">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link to="/servers">
        <Button variant="secondary">Go to Servers</Button>
      </Link>
    </div>
  );
};
