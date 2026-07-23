declare const _default: {
    content: string[];
    theme: {
        extend: {
            colors: {
                harness: {
                    bg: string;
                    panel: string;
                    border: string;
                    text: string;
                    muted: string;
                    accent: string;
                    success: string;
                };
            };
            boxShadow: {
                panel: string;
                glow: string;
                card: string;
            };
            fontFamily: {
                sans: [string, string, string, string];
                mono: [string, string, string, string];
            };
            keyframes: {
                "fade-up": {
                    from: {
                        opacity: string;
                        transform: string;
                    };
                    to: {
                        opacity: string;
                        transform: string;
                    };
                };
                "pulse-dot": {
                    "0%, 100%": {
                        opacity: string;
                        transform: string;
                    };
                    "50%": {
                        opacity: string;
                        transform: string;
                    };
                };
                shimmer: {
                    from: {
                        transform: string;
                    };
                    to: {
                        transform: string;
                    };
                };
                "typing-dot": {
                    "0%, 60%, 100%": {
                        transform: string;
                        opacity: string;
                    };
                    "30%": {
                        transform: string;
                        opacity: string;
                    };
                };
                "aurora-drift": {
                    "0%, 100%": {
                        transform: string;
                    };
                    "50%": {
                        transform: string;
                    };
                };
            };
            animation: {
                "fade-up": string;
                "pulse-dot": string;
                shimmer: string;
                "typing-dot": string;
                "aurora-drift": string;
            };
        };
    };
    plugins: any[];
};
export default _default;
