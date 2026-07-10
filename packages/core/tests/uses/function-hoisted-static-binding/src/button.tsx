import styles from "./button.module.css";

const variant = "outer";

export function Button() {
  const className = styles[variant];

  function variant() {
    return "inner";
  }

  return <button className={className}>{variant()}</button>;
}
