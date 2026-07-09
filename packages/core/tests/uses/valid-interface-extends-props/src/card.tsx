import styles from "./card.module.css";

interface SizingProps {
  size: "compact" | "wide";
}

interface ToneProps {
  tone: "neutral" | "accent";
}

interface Props extends SizingProps, ToneProps {
  variant: "solid" | "outline";
}

export function Card({ size, tone, variant }: Props) {
  return <article className={`${styles[size]} ${styles[tone]} ${styles[variant]}`} />;
}
