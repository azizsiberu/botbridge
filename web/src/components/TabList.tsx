import { useRef } from 'react';

export function TabList({
  id,
  label,
  items,
  value,
  onChange,
}: {
  id: string;
  label: string;
  items: readonly (readonly [string, string])[];
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="tabs mt-3" role="tablist" aria-label={label} ref={ref}>
      {items.map(([key, title], index) => (
        <button
          key={key}
          type="button"
          role="tab"
          id={`${id}-${key}`}
          aria-controls={`${id}-panel`}
          aria-selected={value === key}
          tabIndex={value === key ? 0 : -1}
          onClick={() => onChange(key)}
          onKeyDown={(event) => {
            let next: number;
            if (event.key === 'ArrowRight') next = (index + 1) % items.length;
            else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = items.length - 1;
            else return;
            event.preventDefault();
            const item = items[next];
            if (item) {
              onChange(item[0]);
              ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }
          }}
        >
          {title}
        </button>
      ))}
    </div>
  );
}
