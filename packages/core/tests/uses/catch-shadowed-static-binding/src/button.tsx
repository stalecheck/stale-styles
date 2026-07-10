import styles from "./button.module.css";

const variant = "outer";

export function Button() {
  try {
    throw new Error("failure");
  } catch (variant) {
    return <button className={styles[variant]} />;
  }
}
