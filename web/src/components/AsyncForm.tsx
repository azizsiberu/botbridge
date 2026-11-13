import { createContext, useRef, useState, type FormEvent, type ReactNode } from 'react';

export const FormPending = createContext(false);

/** One pending boundary for every form: disables all controls and blocks duplicate submits. */
export function Form({
  children,
  className,
  onSubmit,
}: {
  children: ReactNode;
  className?: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<unknown>;
}) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (lock.current) return;
        lock.current = true;
        setPending(true);
        setError('');
        try {
          await onSubmit(event);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not save. Try again.');
        } finally {
          lock.current = false;
          setPending(false);
        }
      }}
      aria-busy={pending}
    >
      <FormPending value={pending}>
        <fieldset disabled={pending} className={className}>
          {children}
          {error && (
            <div role="alert" className="error">
              <p>{error}</p>
            </div>
          )}
        </fieldset>
      </FormPending>
    </form>
  );
}
