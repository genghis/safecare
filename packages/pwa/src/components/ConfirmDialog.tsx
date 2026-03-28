import { useEffect } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  destructive = false,
}: ConfirmDialogProps) {
  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3
          style={{
            fontSize: 18,
            fontWeight: 700,
            marginBottom: 8,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontSize: 15,
            color: "var(--color-text-secondary)",
            lineHeight: 1.5,
            marginBottom: 24,
          }}
        >
          {message}
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            className="btn btn-secondary"
            style={{ flex: 1, fontSize: 15, padding: "14px 12px" }}
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            className={`btn ${destructive ? "btn-danger" : "btn-primary"}`}
            style={{ flex: 1, fontSize: 15, padding: "14px 12px" }}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
