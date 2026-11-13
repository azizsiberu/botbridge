import type { SVGProps } from 'react';
import mark from '../brand/mark.json';

/** The same vector geometry generates every app icon and favicon. */
export function BrandMark({ size = 24, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox={mark.viewBox} fill="currentColor" {...props}>
      {mark.paths.map((path, index) => (
        <path d={path} fillRule="evenodd" key={index} />
      ))}
    </svg>
  );
}
