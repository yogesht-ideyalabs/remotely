import type { CSSProperties } from "react";

export function Icon({ name, size = 16, style, className }: { name: string; size?: number; style?: CSSProperties; className?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ""}`} style={{ width: size, height: size, ...style }} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
