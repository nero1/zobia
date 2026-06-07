import { forwardRef, type HTMLAttributes } from 'react';
import { clsx } from 'clsx';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, children, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={clsx(
        'rounded-xl border border-neutral-200 bg-white shadow-sm',
        'dark:border-neutral-700 dark:bg-neutral-900',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

Card.displayName = 'Card';
