import styles from "./button.module.css";

let classMap = { primary: "primary" };
classMap = { primary: "missing" };

export function Button() {
  return <button className={styles[classMap.primary]} />;
}
