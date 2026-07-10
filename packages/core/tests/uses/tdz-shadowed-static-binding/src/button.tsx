import styles from "./button.module.css";

const variant = "outer";

export function Button() {
  {
    const className = styles[variant];
    const variant = "inner";

    return <button className={className} />;
  }
}
