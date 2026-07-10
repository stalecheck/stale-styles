import styles from "./button.module.css";

const variant = "outer";

export function Button(variant) {
  return <button className={styles[variant]} />;
}
