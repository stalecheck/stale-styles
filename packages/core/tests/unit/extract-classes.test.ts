import { describe, expect, it } from "vitest";
import { extractCssClasses } from "../../src/css/extract-classes";

describe("CSS class extraction", () => {
  it("extracts standalone classes from nested CSS selectors", () => {
    const source = `
      .button {
        color: red;

        &.active {
          color: blue;
        }

        & .icon {
          display: inline-block;
        }

        .label {
          font-weight: 600;
        }

        @media (min-width: 40rem) {
          &.wide {
            padding: 1rem;
          }
        }
      }
    `;

    const result = extractCssClasses(source);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    expect([...result.classes].sort()).toEqual(["active", "button", "icon", "label", "wide"]);
  });

  it("extracts CSS Module exports from compound nested selectors", () => {
    const source = `
      .one {
        &.two {
          color: red;
        }
      }
    `;

    const result = extractCssClasses(source);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    expect([...result.classes].sort()).toEqual(["one", "two"]);
  });

  it("extracts standalone classes through media queries and pseudo selectors", () => {
    const source = `
      .card:hover {
        color: red;
      }

      .card:has(.icon) {
        color: blue;
      }

      .card:not(.disabled) {
        color: green;
      }

      @media (min-width: 40rem) {
        .responsive {
          display: grid;
        }
      }
    `;

    const result = extractCssClasses(source);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    expect([...result.classes].sort()).toEqual(["card", "disabled", "icon", "responsive"]);
  });

  it("keeps global classes out of CSS Module standalone class extraction", () => {
    const source = `
      .button :global(.external) {
        color: red;
      }

      .one :global(.two) {
        color: orange;
      }

      :global(.reset) .button {
        color: blue;
      }

      .alone {
        color: purple;
      }
    `;

    const result = extractCssClasses(source);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    expect([...result.classes].sort()).toEqual(["alone", "button", "one"]);
  });

  it("ignores class-like text inside comments", () => {
    const source = `
      .button {
        color: red;

        /* &.commentedOut should not be extracted */

        &.active {
          color: blue;
        }
      }
    `;

    const result = extractCssClasses(source);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    expect([...result.classes].sort()).toEqual(["active", "button"]);
  });

  it("keeps keyframe names out of CSS Module classes", () => {
    const result = extractCssClasses(`
      .button {
        animation: fade-in 200ms ease;
      }

      @keyframes fade-in {
        from {
          opacity: 0;
        }

        to {
          opacity: 1;
        }
      }

      @keyframes unused-spin {
        from {
          transform: rotate(0deg);
        }

        to {
          transform: rotate(360deg);
        }
      }
    `);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    expect([...result.classes].sort()).toEqual(["button"]);
    expect([...result.importableClasses.keys()].sort()).toEqual(["button"]);
  });

  it("keeps standalone empty selectors as classes and marks them as empty", () => {
    const source = `
      .marker {
        /* EMPTY */
      }

      .button {
        color: red;
      }

      .one.two {
        /* EMPTY */
      }
    `;

    const result = extractCssClasses(source);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    expect([...result.classes].sort()).toEqual(["button", "marker"]);
    expect([...result.emptyClasses].sort()).toEqual(["marker"]);
  });

  it("marks each standalone compound in an empty descendant selector", () => {
    const result = extractCssClasses(`
      .parent .child {
        /* EMPTY */
      }

      .compound.one {
        /* EMPTY */
      }
    `);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    expect([...result.emptyClasses].sort()).toEqual(["child", "parent"]);
  });

  it("does not transform importable class names by default", () => {
    const result = extractCssClasses(`
      .primary_button {
        color: red;
      }

      .is-active {
        color: blue;
      }
    `);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    expect([...result.importableClasses.keys()].sort()).toEqual(["is-active", "primary_button"]);
  });

  it("can add camelCase importable class names", () => {
    const result = extractCssClasses(
      `
        .primary_button {
          color: red;
        }

        .is-active {
          color: blue;
        }
      `,
      "input.module.css",
      "camelCase"
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    expect([...result.importableClasses.keys()].sort()).toEqual([
      "is-active",
      "isActive",
      "primaryButton",
      "primary_button"
    ]);
  });

  it("can use only dash-camelized importable class names", () => {
    const result = extractCssClasses(
      `
        .primary_button {
          color: red;
        }

        .is-active {
          color: blue;
        }
      `,
      "input.module.css",
      "dashesOnly"
    );

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    expect([...result.importableClasses.keys()].sort()).toEqual(["isActive", "primary_button"]);
  });

  it("extracts local composed class relationships", () => {
    const result = extractCssClasses(`
      .reset {
        appearance: none;
      }

      .base {
        composes: reset;
        color: red;
      }

      .button {
        composes: base;
        color: blue;
      }
    `);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    const composedClasses = [...result.composedClasses.entries()]
      .map<[string, string[]]>(([className, classNames]) => [className, [...classNames].sort()])
      .sort(([classNameA], [classNameB]) => classNameA.localeCompare(classNameB));

    expect(composedClasses).toEqual([
      ["base", ["reset"]],
      ["button", ["base"]]
    ]);
  });

  it("keeps global and dependency composes out of local composed classes", () => {
    const result = extractCssClasses(`
      .button {
        composes: reset from "./reset.module.css";
        composes: global-reset from global;
        color: blue;
      }
    `);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.message);
    }

    expect([...result.composedClasses.entries()]).toEqual([]);
  });
});
