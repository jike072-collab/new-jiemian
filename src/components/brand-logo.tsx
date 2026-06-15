import { cn } from "@/lib/utils";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg
      className={cn("shrink-0", className)}
      viewBox="178 243 668 537"
      role="img"
      aria-label="奥皇 AI"
    >
      <path
        d="M 836 253 L 752 253 L 752 614 L 655 614 L 724 545 L 724 431 L 535 614 L 471 614 L 723 371 L 723 254 L 188 770 L 309 770 L 384 697 L 448 697 L 373 770 L 493 770 L 569 697 L 751 697 L 752 770 L 836 770 Z"
        fill="currentColor"
      />
    </svg>
  );
}
