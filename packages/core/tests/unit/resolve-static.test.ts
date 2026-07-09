import { describe, expect, it } from "vitest";
import type { AstNode } from "../../src/source/ast";
import { isAstNode, walkAst } from "../../src/source/ast";
import { parseSourceFile } from "../../src/source/parse";
import { createStaticResolver } from "../../src/source/resolve-static";

describe("createStaticResolver", () => {
  it("expands template literals with multiple typed union expressions", () => {
    const resolved = resolveComputedStyleProperties(`
      import styles from "./button.module.css";

      const tone: "Primary" | "Secondary" = "Primary";
      const state: "Active" | "Disabled" = "Active";

      styles[\`button\${tone}\${state}\`];
    `);

    expect(resolved).toEqual([
      [
        "buttonPrimaryActive",
        "buttonPrimaryDisabled",
        "buttonSecondaryActive",
        "buttonSecondaryDisabled"
      ]
    ]);
  });

  it("expands template literals with typed numeric union expressions", () => {
    const resolved = resolveComputedStyleProperties(`
      import styles from "./button.module.css";

      type Step = 0 | 1 | 2;

      export function Button({ step }: { step: Step }) {
        return styles[\`item\${step}\`];
      }
    `);

    expect(resolved).toEqual([["item0", "item1", "item2"]]);
  });

  it("resolves destructured prop aliases with defaults through type aliases", () => {
    const resolved = resolveComputedStyleProperties(`
      import styles from "./button.module.css";

      type Variant = "primary" | "secondary";

      export function Button({ variant: selected = "primary" }: { variant?: Variant }) {
        return styles[selected];
      }
    `);

    expect(resolved).toEqual([["primary", "secondary"]]);
  });

  it("resolves destructured props through interfaces with type alias properties", () => {
    const resolved = resolveComputedStyleProperties(`
      import clsx from "clsx";
      import styles from "./button.module.css";

      type Position = "top" | "bottom";

      interface Props {
        position: Position;
      }

      export function Button({ position }: Props) {
        return clsx(styles[position]);
      }
    `);

    expect(resolved).toEqual([["top", "bottom"]]);
  });

  it("resolves forwardRef destructured props through intersection type aliases", () => {
    const resolved = resolveComputedStyleProperties(`
      import { forwardRef, type HTMLAttributes } from "react";
      import styles from "./separator.module.css";

      type Props = HTMLAttributes<HTMLHRElement> & {
        variant?: "solid" | "dotted";
      };

      export const Separator = forwardRef<HTMLHRElement, Props>(
        ({ variant = "solid", ...props }, ref) => {
          return <hr ref={ref} className={styles[variant]} {...props} />;
        }
      );

      const variant = "outside";
      styles[variant];
    `);

    expect(resolved).toEqual([["solid", "dotted"], ["outside"]]);
  });

  it("resolves known properties from mixed intersection type aliases", () => {
    const resolved = resolveComputedStyleProperties(`
      import { type HTMLAttributes } from "react";
      import styles from "./badge.module.css";

      type SizeProps = {
        size: "sm" | "lg";
      };

      type Props = HTMLAttributes<HTMLSpanElement> &
        SizeProps & {
          tone: "info" | "danger";
        } & {
          align: "start" | "end";
        };

      export function Badge({ size, tone, align }: Props) {
        return [
          styles[size],
          styles[tone],
          styles[\`align-\${align}\`],
        ];
      }
    `);

    expect(resolved).toEqual([
      ["sm", "lg"],
      ["info", "danger"],
      ["align-start", "align-end"]
    ]);
  });

  it("resolves interface inheritance from known base interfaces", () => {
    const resolved = resolveComputedStyleProperties(`
      import styles from "./card.module.css";

      interface SizingProps {
        size: "compact" | "wide";
      }

      interface ToneProps {
        tone: "neutral" | "accent";
      }

      interface Props extends SizingProps, ToneProps {
        variant: "solid" | "outline";
      }

      export function Card({ size, tone, variant }: Props) {
        return [
          styles[size],
          styles[tone],
          styles[variant],
        ];
      }
    `);

    expect(resolved).toEqual([
      ["compact", "wide"],
      ["neutral", "accent"],
      ["solid", "outline"]
    ]);
  });

  it("resolves interfaces extending object type aliases", () => {
    const resolved = resolveComputedStyleProperties(`
      import styles from "./card.module.css";

      type SizingProps = {
        size: "compact" | "wide";
      };

      interface Props extends SizingProps {
        variant: "solid" | "outline";
      }

      export function Card({ size, variant }: Props) {
        return [
          styles[size],
          styles[variant],
        ];
      }
    `);

    expect(resolved).toEqual([
      ["compact", "wide"],
      ["solid", "outline"]
    ]);
  });

  it("resolves object literal maps and string enum members", () => {
    const resolved = resolveComputedStyleProperties(`
      import styles from "./button.module.css";

      const classMap = {
        primary: "primary",
        secondary: "secondary",
      } as const;

      enum Variant {
        Primary = "primary",
        Secondary = "secondary",
      }

      styles[classMap.primary];
      styles[Variant.Secondary];
    `);

    expect(resolved).toEqual([["primary"], ["secondary"]]);
  });

  it("resolves identifiers from the scope visible at the class access", () => {
    const resolved = resolveComputedStyleProperties(`
      import styles from "./button.module.css";

      const variant = "primary";

      function helper() {
        const variant = "ghost";
        return variant;
      }

      styles[variant];
    `);

    expect(resolved).toEqual([["primary"]]);
  });
});

function resolveComputedStyleProperties(source: string): string[][] {
  const parsed = parseSourceFile("fixture.tsx", source);

  if (!parsed.ok) {
    throw new Error(parsed.message);
  }

  const resolveStatic = createStaticResolver(parsed.program);
  const resolved: string[][] = [];

  walkAst(parsed.program, (node) => {
    if (!isComputedStylesMember(node)) {
      return;
    }

    const values = resolveStatic(node.property);

    if (values) {
      resolved.push(values);
    }
  });

  return resolved;
}

function isComputedStylesMember(node: AstNode): node is AstNode & { property: AstNode } {
  return (
    node.type === "MemberExpression" &&
    node.computed === true &&
    isAstNode(node.object) &&
    node.object.type === "Identifier" &&
    node.object.name === "styles" &&
    isAstNode(node.property)
  );
}
