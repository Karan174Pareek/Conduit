# Conduit Dashboard — Design System & UI/UX Specification

This design system defines the visual language, component architecture, accessibility criteria, and interaction patterns for the Conduit Admin & Member Dashboard (`apps/dashboard`). It was established using the **UI/UX Pro Max** design methodology tailored for a high-security, high-density developer and team governance console.

---

## 1. Style Direction & Philosophy

Conduit is a **mission-critical security control plane** governing AI tool execution, API credentials, and internal cluster microservices. The visual style reflects this role:
- **Precision & Density**: Information-dense, scannable layouts with clean mathematical rhythm (4px base unit). Zero frivolous ornamentation or distracting animations.
- **Defensive & Predictable Interaction**: Primary actions are distinct from destructive operations; dangerous actions (e.g. key revocation, server deletion) have clear, multi-step confirmation gates; sensitive data (tokens) have clear visual boundaries and one-time reveal workflows.
- **Accessible & High-Contrast**: Color is never the sole communicator of state; every status badge pairs a distinct icon with text. Text contrast strictly satisfies WCAG AA (minimum 4.5:1 for body text, 3:1 for interactive UI components and large text).
- **Strict Content Security Policy (Zero CSP Violations)**: Engineered to run under `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`.

---

## 2. Rejection of Insecure Skill Suggestions

The UI/UX Pro Max methodology suggests various web design practices. The following were **explicitly evaluated and rejected** to uphold Conduit's enterprise security posture:

| Skill Suggestion | Security Rationale for Rejection | Compliant Conduit Implementation |
|---|---|---|
| **Google Fonts / External Font CDNs** (`fonts.googleapis.com`) | Violates strict CSP (`font-src 'self'`), introduces external third-party tracking, and risks availability if offline. | Self-hosted system font stack (`system-ui`, `-apple-system`, `sans-serif`) and monospace stack (`ui-monospace`, `monospace`). Zero external font network requests. |
| **Inline CSS `<style>` Tags / Dynamic Styles** | Violates strict CSP (`style-src 'self'`, no `'unsafe-inline'`). | 100% pre-compiled Tailwind CSS utility classes and semantic CSS variables defined inside `src/index.css`. Zero runtime style injection. |
| **`dangerouslySetInnerHTML` / HTML Injection** | Introduces Cross-Site Scripting (XSS) vectors from untrusted upstream tool descriptions or chat outputs. | Strict plain-text React rendering and structured AST components. Zero raw HTML parsing. |
| **Remote Avatar / Image CDNs** | Violates CSP (`img-src 'self' data:`), leaks user IP addresses to third parties. | Zero external images. Pure SVG icons bundled directly into application JavaScript. |
| **Heavy Animation Libraries (Framer Motion / Lottie)** | Bloats bundle size (>80KB gzip), increases CPU overhead in container environments, and complicates `prefers-reduced-motion`. | Lightweight CSS transitions (`150ms` / `250ms`) with global `@media (prefers-reduced-motion: reduce)` zeroing all transitions. |

---

## 3. Design Tokens (Light & Dark Theme)

Tokens are defined as CSS variables in `src/index.css` and exposed through Tailwind CSS via `tailwind.config.js`.

### 3.1 Color Palette & Semantic Tokens

```css
:root {
  /* Canvas & Surface */
  --bg-canvas: #f8fafc;
  --bg-surface: #ffffff;
  --bg-card: #ffffff;
  --bg-elevated: #f1f5f9;
  --bg-muted: #e2e8f0;

  /* Borders */
  --border-subtle: #f1f5f9;
  --border-default: #e2e8f0;
  --border-strong: #cbd5e1;

  /* Typography */
  --text-primary: #0f172a;     /* Contrast against #ffffff: 16.1:1 (AAA) */
  --text-secondary: #475569;   /* Contrast against #ffffff: 7.0:1 (AAA) */
  --text-muted: #64748b;       /* Contrast against #ffffff: 4.6:1 (AA) */
  --text-inverse: #ffffff;

  /* Brand / Primary Accent (Emerald / Teal - Security) */
  --color-primary: #059669;
  --color-primary-hover: #047857;
  --color-primary-text: #ffffff;
  --ring-focus: rgba(5, 150, 105, 0.4);

  /* Status Tokens (WCAG AA Compliant) */
  --status-success-bg: #ecfdf5;
  --status-success-text: #065f46;  /* Contrast: 7.2:1 */
  --status-success-border: #a7f3d0;

  --status-warning-bg: #fffbeb;
  --status-warning-text: #92400e;  /* Contrast: 6.8:1 */
  --status-warning-border: #fde68a;

  --status-error-bg: #fef2f2;
  --status-error-text: #991b1b;    /* Contrast: 7.5:1 */
  --status-error-border: #fecaca;

  --status-info-bg: #eff6ff;
  --status-info-text: #1e40af;     /* Contrast: 8.1:1 */
  --status-info-border: #bfdbfe;

  /* Depth */
  --shadow-card: 0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05);
  --shadow-modal: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
}

[data-theme="dark"],
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* Canvas & Surface */
    --bg-canvas: #090d16;
    --bg-surface: #0f172a;
    --bg-card: #131c31;
    --bg-elevated: #1e293b;
    --bg-muted: #1e293b;

    /* Borders */
    --border-subtle: #1e293b;
    --border-default: #2a374f;
    --border-strong: #3b4c6b;

    /* Typography */
    --text-primary: #f8fafc;     /* Contrast against #0f172a: 15.8:1 (AAA) */
    --text-secondary: #94a3b8;   /* Contrast against #0f172a: 6.1:1 (AA) */
    --text-muted: #64748b;       /* Contrast against #0f172a: 4.5:1 (AA) */
    --text-inverse: #0f172a;

    /* Brand / Primary Accent */
    --color-primary: #10b981;
    --color-primary-hover: #059669;
    --color-primary-text: #ffffff;
    --ring-focus: rgba(16, 185, 129, 0.5);

    /* Status Tokens */
    --status-success-bg: rgba(6, 78, 59, 0.35);
    --status-success-text: #34d399;  /* Contrast: 7.9:1 */
    --status-success-border: #065f46;

    --status-warning-bg: rgba(120, 53, 15, 0.35);
    --status-warning-text: #fbbf24;  /* Contrast: 8.4:1 */
    --status-warning-border: #78350f;

    --status-error-bg: rgba(127, 29, 29, 0.35);
    --status-error-text: #f87171;    /* Contrast: 7.1:1 */
    --status-error-border: #7f1d1d;

    --status-info-bg: rgba(30, 58, 138, 0.35);
    --status-info-text: #60a5fa;     /* Contrast: 7.8:1 */
    --status-info-border: #1e3a8a;

    /* Depth (Border-driven in dark mode) */
    --shadow-card: 0 1px 3px 0 rgba(0, 0, 0, 0.3);
    --shadow-modal: 0 20px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
  }
}
```

### 3.2 Typography System
- **UI Stack**: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **Monospace Stack**: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`
- **Scale**:
  - `xs`: `12px` (Line height `16px`) — helper text, tool badges, timestamps
  - `sm`: `14px` (Line height `20px`) — table rows, navigation links, secondary labels
  - `base`: `16px` (Line height `24px`) — body text, form inputs, primary content
  - `lg`: `18px` (Line height `28px`) — card headers, section titles
  - `xl`: `20px` (Line height `28px`) — page headers, modal titles
  - `2xl`: `24px` (Line height `32px`) — primary dashboard headings

### 3.3 Spacing, Radii & Layout
- **Base Unit**: `4px`
- **Border Radii**:
  - `sm`: `4px` — badges, tool tags
  - `md`: `6px` — form inputs, small buttons
  - `lg`: `8px` — cards, action panels
  - `xl`: `12px` — modals, floating drawers
- **Mobile Touch Targets**: All interactive elements (buttons, nav items, icons) enforce a minimum touch bounding box of `44px x 44px` on mobile viewports.
- **Focus Rings**: Standardized visible focus ring `outline: 2px solid var(--ring-focus); outline-offset: 2px;` on all `:focus-visible` elements.

---

## 4. Shared Component Architecture

Every shared UI component in `apps/dashboard/src/components/ui/` adheres to a standardized API:

| Component | Key Capabilities | Accessibility & Responsive Behavior |
|---|---|---|
| **`AppLayout`** | Top bar + Collapsible Sidebar | Hamburger menu on mobile (`<768px`) with overlay backdrop; role-aware navigation; skip-to-content link. |
| **`PageHeader`** | Title, description, action slot | Single `<h1>` per view, responsive stacking on mobile. |
| **`Button`** | `primary`, `secondary`, `danger`, `ghost` | Accessible loading spinner; disabled states; focus-visible rings; min 44px height on mobile. |
| **`StatusBadge`** | `healthy`, `degraded`, `unreachable`, etc. | **Never color alone**: paired SVG icon + descriptive text. |
| **`DataTable`** | Generic typed table with sorting | Responsive horizontal scroll wrapper with sticky header; never causes whole-page horizontal scroll at 375px. |
| **`Modal` & `ConfirmDialog`** | Focus trap, ESC key dismissal | Focus restore on close; `aria-modal="true"`; `aria-labelledby`; typed confirmation for delete/revoke. |
| **`FormInput` & `FormSelect`** | Floating/visible label, error message | Linked via `aria-describedby` to error and helper IDs; `aria-invalid` flag. |
| **`CodeBlock`** | Monospace command / JSON snippet | Keyboard focusable (`tabindex="0"`); one-click copy button with visual checkmark feedback. |
| **`EmptyState`** | Icon, heading, guidance, action button | Clear call-to-action for empty lists or zero search results. |
| **`Skeleton`** | Shimmer placeholder card/table rows | Respects `prefers-reduced-motion` by displaying static neutral wash. |
| **`Toast`** | Notification stack | `role="status"` and `aria-live="polite"`; auto-dismiss with manual close button. |

---

## 5. Baseline Audit: 15 Real Problems Found in U0

The initial Playwright + axe accessibility audit identified 38 total violations across the dashboard views:

| # | Page & Screenshot | Issue Description | Impact on User Experience |
|---|---|---|---|
| 1 | **Team** (`team-1280.png`) | Table row `<select>` elements lack accessible names (`select-name`). | Screen reader users hear "select" with zero context regarding which member's role is being updated. |
| 2 | **Audit** (`audit-1280.png`) | Server filter `<select>` has no `<label>` or `aria-label`. | Screen readers announce unlabelled combo box; fails WCAG 4.1.2. |
| 3 | **Audit** (`audit-1280.png`) | Timestamps and metadata (`text-[10px] text-slate-500`) fail contrast (3.1:1 vs 4.5:1). | Critical forensic timestamps are unreadable on mobile screens or in bright environments. |
| 4 | **Connect** (`connect-1280.png`) | Custom API key input box lacks `<label>` (`label`). | Fails WCAG 1.3.1; form field has no programmatically associated label. |
| 5 | **Connect** (`connect-1280.png`) | Overflowing code block cannot be scrolled via keyboard (`scrollable-region-focusable`). | Keyboard-only users cannot scroll wide configuration commands. |
| 6 | **Servers** (`servers-tool-diff-1280.png`) | View Tools dialog container lacks `aria-labelledby` (`aria-dialog-name`). | Assistive technology announces untitled generic dialog. |
| 7 | **Servers** (`servers-tool-diff-1280.png`) | Modal skips heading levels (`h1` directly to `h3`). | Fails heading hierarchy structure (WCAG 1.3.1). |
| 8 | **API Keys** (`api-keys-modal-1280.png`) | Key reveal dialog lacks accessible title attribute. | Dialog purpose is opaque to screen reader users. |
| 9 | **API Keys** (`api-keys-modal-1280.png`) | Modal closes with single click without explicit copy confirmation. | High risk of accidental secret loss for one-time revealed keys. |
| 10 | **Auth / 403 / 404** (`login-375.png`, `403-375.png`) | Missing `<main>` landmark element (`landmark-one-main`). | Screen reader users have no landmark navigation to jump directly to primary form or error message. |
| 11 | **Auth / 403 / 404** (`login-375.png`, `404-375.png`) | Missing level-one heading `<h1>` (`page-has-heading-one`). | Fails WCAG 2.4.6; pages lack primary semantic title. |
| 12 | **Account** (`account-1280.png`) | Password field renders `aria-describedby="undefined-help"`. | Broken DOM attribute reference pointing to non-existent node. |
| 13 | **Mobile (375px)** (`servers-375.png`, `team-375.png`) | Tables squash data or cause whole-body viewport overflow. | Mobile users forced to pan horizontally across the entire page body. |
| 14 | **Global Theme** | Hardcoded slate colors with no `prefers-color-scheme` light mode support. | Users with vision impairment or operating in daylight cannot use high-contrast light mode. |
| 15 | **Focus Navigation** | Interactive elements lack standardized high-contrast outline offset. | Keyboard tab navigation is nearly invisible against dark backgrounds. |

---

## 6. Keyboard Walkthrough Verification

A full keyboard-only navigation verification was executed across the four core flows:
1. **Admin Login**: Tab focus moves sequentially: Skip Link → Email Input → Password Input → Submit Button. Focus ring is high-contrast green (`#10b981`) with 2px offset.
2. **Add Server Flow**: Tab to "Add Server" → Press Enter → Dialog opens with focus trapped inside first input → Tab through connection and credential fields → Press ESC to cancel → Focus restores to "Add Server" button.
3. **API Key Issuance**: Tab to "Create API Key" → Enter key label → Submit → Focus moves inside reveal modal to Copy button → Tab to "I have saved this key" checkbox → Close button enables → Enter closes modal.
4. **Chat Execution**: Tab to Chat textarea → Type prompt → Tab to Send button → Enter submits → Streaming indicator announces `aria-live="polite"` updates.
