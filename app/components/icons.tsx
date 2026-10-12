import type { SVGProps } from "react";

// Small stroke icons, drawn on a 24px grid and sized by the caller.
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export const CalendarIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </Icon>
);

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const DoorIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 20.5V4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16M3.5 20.5h17" />
    <circle cx="14.5" cy="12.5" r=".6" fill="currentColor" />
  </Icon>
);

export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
  </Icon>
);

export const MailIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
    <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
  </Icon>
);

export const TagIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 12.2V5a1.5 1.5 0 0 1 1.5-1.5h7.2a1.5 1.5 0 0 1 1 .44l6.9 6.9a1.5 1.5 0 0 1 0 2.12l-7.2 7.2a1.5 1.5 0 0 1-2.12 0l-6.9-6.9a1.5 1.5 0 0 1-.44-1.06Z" />
    <circle cx="8.5" cy="8.5" r="1.2" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const ArrowUpIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={2}>
    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </Icon>
);

export const ExternalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5M12 16v.01" />
  </Icon>
);

/** The assistant's mark: two nested arches, like a doorway into a room. */
export const AssistantMark = (p: IconProps) => (
  <Icon {...p} strokeWidth={1.6}>
    <path d="M5.5 20V10.5a6.5 6.5 0 0 1 13 0V20" />
    <path d="M9.5 20v-7.5a2.5 2.5 0 0 1 5 0V20" />
  </Icon>
);
