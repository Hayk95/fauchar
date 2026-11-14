import Link from "next/link";
import { VOXEL_CELLS } from "@/lib/brandMark";

type Props = {
  href?: string;
  className?: string;
};

/** Shared FAUCHAR wordmark + mark used in marketing chrome. */
export default function Logo({ href = "/", className = "logo" }: Props) {
  return (
    <Link className={className} href={href} aria-label="FAUCHAR, home">
      <svg className="mark" viewBox="0 0 64 80" aria-hidden="true">
        {VOXEL_CELLS.map((cell) => (
          <rect
            key={`${cell.x}-${cell.y}`}
            x={cell.x}
            y={cell.y}
            width={6}
            height={6}
            rx={1}
            fill={cell.lime ? "#B7F34A" : "currentColor"}
          />
        ))}
      </svg>
      <span className="logo-lockup" aria-hidden="true">
        <svg className="logo-word" viewBox="-1.5 -1.5 157 23.6" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M1.2 20V1.2H13M1.2 10.4H11" />
            <path d="M22 20.6 29 1 36 20.6" />
            <path d="M45.2 0v12.6a6.8 6.8 0 0 0 13.6 0V0" />
            <path d="M85.5 4.3A9.6 9.6 0 1 0 85.5 15.7" />
            <path d="M94.2 0v20M108.6 0v20M94.2 10.2h14.4" />
            <path d="M117 20.6 124 1 131 20.6" />
            <path d="M141.2 20V1.2h7.6a5.3 5.3 0 0 1 0 10.6h-7.6M147.6 11.8 154 20" />
          </g>
        </svg>
        <span className="logo-descriptor">Dental Intelligence</span>
      </span>
    </Link>
  );
}
