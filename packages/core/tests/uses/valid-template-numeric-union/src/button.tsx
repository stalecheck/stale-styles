import styles from "./button.module.css";

type Step = 0 | 1 | 2;

export function Button({ step }: { step: Step }) {
  return <button className={styles[`item${step}`]}>Next</button>;
}
