import styles from "./button.module.css";

let variant = "primary";

export function Button() {
  return <button className={styles[variant]} />;
}
