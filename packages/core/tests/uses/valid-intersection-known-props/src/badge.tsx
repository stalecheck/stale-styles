import { type HTMLAttributes } from "react";
import styles from "./badge.module.css";

type SizeProps = {
  size: "sm" | "lg";
};

type Props = HTMLAttributes<HTMLSpanElement> &
  SizeProps & {
    tone: "info" | "danger";
    align: "start" | "end";
  };

export function Badge({ size, tone, align }: Props) {
  return (
    <span className={`${styles[size]} ${styles[tone]} ${styles[`align-${align}`]}`}>Badge</span>
  );
}
