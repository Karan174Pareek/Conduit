import { useState } from 'react';
import { CopyIcon, CheckIcon } from './Icons';

export interface CodeBlockProps {
  code: string;
  language?: string;
  label?: string;
  className?: string;
}

export function CodeBlock({ code, language = 'bash', label, className = '' }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className={`relative group rounded-lg border border-border bg-elevated/70 overflow-hidden ${className}`}>
      {label && (
        <div className="flex items-center justify-between px-4 py-2 bg-elevated border-b border-border text-xs font-medium text-txt-secondary">
          <span>{label}</span>
          <span className="uppercase text-[10px] tracking-wider text-txt-muted">{language}</span>
        </div>
      )}
      <div className="relative">
        <pre
          tabIndex={0}
          role="region"
          aria-label={label ? `${label} code snippet` : 'Code snippet'}
          className="p-4 overflow-x-auto text-xs sm:text-sm font-mono text-txt-primary focus:outline-none focus:ring-1 focus:ring-brand leading-relaxed"
        >
          <code>{code}</code>
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Code snippet copied' : 'Copy code snippet'}
          className="absolute top-3 right-3 p-2 rounded-md bg-card/80 backdrop-blur-sm border border-border text-txt-secondary hover:text-txt-primary hover:bg-elevated transition-colors shadow-sm min-w-[36px] min-h-[36px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {copied ? (
            <span className="flex items-center gap-1 text-xs text-status-success-text font-medium">
              <CheckIcon className="w-4 h-4 text-brand" />
              <span className="hidden sm:inline">Copied</span>
            </span>
          ) : (
            <CopyIcon className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
