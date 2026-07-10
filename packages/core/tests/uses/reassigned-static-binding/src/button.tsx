import styles from "./button.module.css";

let variant = "outer";
variant = "missing";

export function Button() {
  return <button className={styles[variant]} />;
}
