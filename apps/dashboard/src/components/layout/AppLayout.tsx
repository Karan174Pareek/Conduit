import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

export const AppLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive
        ? 'bg-slate-800 text-white font-semibold'
        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
    }`;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-8">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded bg-cyan-600 flex items-center justify-center font-bold text-white shadow-sm">
                C
              </div>
              <span className="font-bold text-lg tracking-tight text-white">Conduit</span>
            </div>

            <nav className="hidden md:flex items-center space-x-1">
              <NavLink to="/servers" className={navClass}>
                Servers
              </NavLink>
              <NavLink to="/keys" className={navClass}>
                API Keys
              </NavLink>
              <NavLink to="/audit" className={navClass}>
                Audit
              </NavLink>
              {user?.role === 'admin' && (
                <NavLink to="/team" className={navClass}>
                  Team
                </NavLink>
              )}
              <NavLink to="/connect" className={navClass}>
                Connect
              </NavLink>
              <div className="relative group">
                <button
                  type="button"
                  disabled
                  className="px-3 py-2 rounded-md text-sm font-medium text-slate-500 cursor-not-allowed flex items-center space-x-1.5"
                  title="Coming in Phase 5"
                >
                  <span>Chat</span>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                    Phase 5
                  </span>
                </button>
              </div>
            </nav>
          </div>

          <div className="flex items-center space-x-4">
            {user && (
              <div className="flex items-center space-x-3">
                <div className="text-right hidden sm:block">
                  <div className="text-xs text-slate-400">{user.email}</div>
                  <div className="text-xs font-semibold capitalize text-slate-200">
                    <Badge variant={user.role === 'admin' ? 'info' : 'default'} size="sm">
                      {user.role}
                    </Badge>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={handleLogout}>
                  Logout
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
};
