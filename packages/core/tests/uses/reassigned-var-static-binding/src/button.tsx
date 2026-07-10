import styles from "./button.module.css";

var variant = "outer";
variant += "-missing";

export function Button() {
  return <button className={styles[variant]} />;
}
