import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  ServerIcon,
  ShieldIcon,
  UsersIcon,
  KeyIcon,
  TerminalIcon,
  FileTextIcon,
  ChatIcon,
  SettingsIcon,
  LogOutIcon,
  MenuIcon,
  XIcon,
  SunIcon,
  MoonIcon,
} from '../ui/Icons';
import { StatusBadge } from '../ui/StatusBadge';

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    // Read saved theme or system preference
    const saved = localStorage.getItem('conduit_theme') as 'dark' | 'light' | null;
    const hasMatchMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
    const prefersLight = hasMatchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const initialTheme = saved || (prefersLight ? 'light' : 'dark');
    setTheme(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('conduit_theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const isAdmin = user?.role === 'admin';

  const navItems = [
    { to: '/servers', label: 'Servers', icon: <ServerIcon className="w-5 h-5" /> },
    { to: '/chat', label: 'Chat', icon: <ChatIcon className="w-5 h-5" /> },
    ...(isAdmin ? [{ to: '/team', label: 'Team', icon: <UsersIcon className="w-5 h-5" /> }] : []),
    { to: '/keys', label: 'API Keys', icon: <KeyIcon className="w-5 h-5" /> },
    ...(isAdmin ? [{ to: '/audit', label: 'Audit Log', icon: <FileTextIcon className="w-5 h-5" /> }] : []),
    ...(isAdmin ? [{ to: '/policies', label: 'Policies', icon: <ShieldIcon className="w-5 h-5" /> }] : []),
    { to: '/connect', label: 'Connect Client', icon: <TerminalIcon className="w-5 h-5" /> },
    { to: '/account', label: 'Account', icon: <SettingsIcon className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-screen bg-canvas text-txt-primary flex flex-col">
      {/* Accessibility: Skip link */}
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>

      {/* Top Navbar */}
      <header className="sticky top-0 z-30 bg-surface/90 backdrop-blur-md border-b border-border h-16 flex items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-txt-secondary hover:text-txt-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-sidebar"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          >
            {mobileMenuOpen ? <XIcon className="w-6 h-6" /> : <MenuIcon className="w-6 h-6" />}
          </button>

          <NavLink to="/servers" className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-md p-1">
            <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center text-brand-text font-bold text-lg shadow-sm">
              C
            </div>
            <div className="flex flex-col">
              <span className="font-bold tracking-tight text-txt-primary text-base leading-none">
                Conduit
              </span>
              <span className="text-[10px] text-txt-muted tracking-wider uppercase font-mono mt-0.5">
                MCP Gateway
              </span>
            </div>
          </NavLink>
        </div>

        {/* Top bar right actions */}
        <div className="flex items-center gap-3">
          {/* Theme Toggle Button */}
          <button
            type="button"
            onClick={toggleTheme}
            className="p-2 rounded-lg text-txt-secondary hover:text-txt-primary hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <SunIcon className="w-5 h-5 text-amber-400" /> : <MoonIcon className="w-5 h-5 text-slate-700" />}
          </button>

          {/* User profile info */}
          {user && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-elevated/60 border border-border">
              <span className="text-xs text-txt-secondary truncate max-w-[150px]">
                {user.email}
              </span>
              <StatusBadge status={user.role} />
            </div>
          )}

          {/* Logout button */}
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-txt-secondary hover:text-txt-primary hover:bg-elevated border border-border transition-colors min-h-[44px] sm:min-h-[36px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            aria-label="Log out of Conduit"
          >
            <LogOutIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex flex-col w-60 border-r border-border bg-surface shrink-0">
          <nav className="p-4 space-y-1" aria-label="Main Navigation">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand/10 text-brand font-semibold'
                      : 'text-txt-secondary hover:text-txt-primary hover:bg-elevated'
                  }`
                }
              >
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Mobile Drawer Backdrop */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div
            id="mobile-sidebar"
            className="fixed top-16 left-0 bottom-0 z-50 w-64 bg-surface border-r border-border transform transition-transform duration-200 ease-in-out md:hidden flex flex-col p-4 shadow-modal translate-x-0"
            role="region"
            aria-label="Mobile Navigation Drawer"
          >
            {user && (
              <div className="sm:hidden mb-4 pb-4 border-b border-border flex flex-col gap-1.5">
                <span className="text-xs text-txt-secondary truncate">{user.email}</span>
                <div>
                  <StatusBadge status={user.role} />
                </div>
              </div>
            )}
            <nav className="space-y-1 flex-1 overflow-y-auto" aria-label="Mobile Navigation Items">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3.5 py-3 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                      isActive
                        ? 'bg-brand/10 text-brand font-semibold'
                        : 'text-txt-secondary hover:text-txt-primary hover:bg-elevated'
                    }`
                  }
                >
                  {item.icon}
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        )}

        {/* Main Content Area */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 focus:outline-none"
        >
          <div className="max-w-7xl mx-auto w-full">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
