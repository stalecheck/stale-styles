import { forwardRef, type HTMLAttributes } from "react";
import styles from "./separator.module.css";

type Props = HTMLAttributes<HTMLHRElement> & {
  variant?: "solid" | "dotted";
};

export const Separator = forwardRef<HTMLHRElement, Props>(
  ({ variant = "solid", ...props }, ref) => {
    return <hr ref={ref} className={styles[variant]} {...props} />;
  }
);
