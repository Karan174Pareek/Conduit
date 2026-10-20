import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { AlertTriangleIcon } from './Icons';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'primary';
  requiredTypedConfirmation?: string;
  confirmKeyword?: string;
  loading?: boolean;
  isLoading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  requiredTypedConfirmation,
  confirmKeyword,
  loading = false,
  isLoading = false,
}: ConfirmDialogProps) {
  const [typedInput, setTypedInput] = useState('');
  const requiredText = requiredTypedConfirmation || confirmKeyword;
  const isDialogLoading = Boolean(loading || isLoading);

  const isConfirmed = requiredText
    ? typedInput.trim() === requiredText.trim()
    : true;

  const handleClose = () => {
    setTypedInput('');
    onClose();
  };

  const handleConfirm = () => {
    if (isConfirmed) {
      onConfirm();
      setTypedInput('');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} maxWidth="md">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-status-error-bg text-status-error-text shrink-0">
            <AlertTriangleIcon className="w-5 h-5" />
          </div>
          <p className="text-sm text-txt-secondary leading-relaxed">{message}</p>
        </div>

        {requiredText && (
          <div className="space-y-1.5 pt-2">
            <label
              htmlFor="typed-confirmation-input"
              className="block text-xs font-medium text-txt-secondary"
            >
              To confirm, type{' '}
              <span className="font-mono font-bold text-txt-primary select-all">
                {requiredText}
              </span>{' '}
              below:
            </label>
            <input
              id="typed-confirmation-input"
              type="text"
              value={typedInput}
              onChange={(e) => setTypedInput(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-md text-txt-primary focus:outline-none focus:ring-2 focus:ring-brand font-mono"
              placeholder={requiredText}
              autoComplete="off"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button variant="secondary" onClick={handleClose} disabled={isDialogLoading}>
            {cancelText}
          </Button>
          <Button
            variant={variant === 'primary' ? 'primary' : 'danger'}
            onClick={handleConfirm}
            disabled={!isConfirmed || isDialogLoading}
            isLoading={isDialogLoading}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
