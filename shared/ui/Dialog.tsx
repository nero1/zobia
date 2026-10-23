"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DialogHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
type Props = Omit<DialogHTMLAttributes<HTMLDialogElement>, "onClose"> & {
  onClose: () => void;
};
/** Native top-layer dialog supplies focus containment, inertness and Escape semantics. */
export function AccessibleDialog({
  onClose,
  children,
  className = "",
  ...props
}: Props) {
  const ref = useRef<HTMLDialogElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useLayoutEffect(() => {
    if (!mounted || !ref.current) return;
    const dialog = ref.current,
      previous = document.activeElement;
    if (!dialog.open) dialog.showModal();
    const initial = dialog.querySelector<HTMLElement>(
      "[data-dialog-initial-focus]",
    );
    initial?.focus();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [mounted]);
  if (!mounted) return null;
  return createPortal(
    <dialog
      {...props}
      ref={ref}
      className={`m-0 h-[100dvh] w-screen max-h-none max-w-none border-0 text-foreground ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
