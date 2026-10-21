/** Dấu hiệu "đèn canh": vòng tròn có tia sáng. Vẽ bằng currentColor nên theo màu chữ chung. */
export function Logo({ size = 22 }: { size?: number }) {
    return (
        <svg
            aria-hidden="true"
            focusable="false"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
        >
            <circle cx="12" cy="13" r="5.2" />
            <circle cx="12" cy="13" r="1.6" fill="currentColor" stroke="none" />
            <path d="M12 2.5v3M4.2 5.7l2.1 2.1M19.8 5.7l-2.1 2.1" />
        </svg>
    )
}