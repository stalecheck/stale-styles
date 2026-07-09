import clsx from "clsx";
import styles from "./button.module.css";

type Position = "top" | "bottom";

interface Props {
  position: Position;
}

export function Button({ position }: Props) {
  return <button className={clsx(styles[position])}>Open</button>;
}
