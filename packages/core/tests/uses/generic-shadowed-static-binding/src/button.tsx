import styles from "./button.module.css";

type Variant = "outer";

export function Button<Variant>(variant: Variant) {
  return <button className={styles[variant]} />;
}
