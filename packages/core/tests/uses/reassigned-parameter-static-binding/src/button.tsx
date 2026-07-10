import styles from "./button.module.css";

export function Button(variant: "outer") {
  variant = "missing";

  return <button className={styles[variant]} />;
}
