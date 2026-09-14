import type { Page } from "@playwright/test";

/**
 * Counts how many times each named component function actually ran, per React commit.
 *
 * `RenderProfile` reports a commit whenever anything inside its subtree rendered, so it cannot
 * tell a parent-driven re-render of a pane from a layout-driven render deep inside it. This
 * installs the React DevTools global hook before the app boots and walks each committed fiber
 * tree the way DevTools does: a subtree whose child pointer is unchanged was not rendered, and a
 * component fiber carrying the PerformedWork flag ran its function in this commit.
 */
export async function installComponentRenderCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const FUNCTION_COMPONENT = 0;
    const CLASS_COMPONENT = 1;
    const FORWARD_REF = 11;
    const SIMPLE_MEMO_COMPONENT = 15;
    const PERFORMED_WORK = 1;

    interface Fiber {
      tag: number;
      type: unknown;
      flags: number;
      child: Fiber | null;
      sibling: Fiber | null;
      alternate: Fiber | null;
    }

    function componentName(fiber: Fiber): string | null {
      if (
        fiber.tag !== FUNCTION_COMPONENT &&
        fiber.tag !== CLASS_COMPONENT &&
        fiber.tag !== FORWARD_REF &&
        fiber.tag !== SIMPLE_MEMO_COMPONENT
      ) {
        return null;
      }
      const type =
        fiber.tag === FORWARD_REF ? Reflect.get(Object(fiber.type), "render") : fiber.type;
      if (typeof type !== "function") return null;
      const displayName: unknown = Reflect.get(type, "displayName");
      return typeof displayName === "string" ? displayName : type.name || null;
    }

    function countUpdatedFibers(next: Fiber, counts: Record<string, number>): void {
      const previous = next.alternate;
      if (previous === null) {
        return;
      }
      const name = componentName(next);
      if (name && (next.flags & PERFORMED_WORK) === PERFORMED_WORK) {
        counts[name] = (counts[name] ?? 0) + 1;
      }
      if (next.child === previous.child) {
        return;
      }
      for (let child = next.child; child !== null; child = child.sibling) {
        countUpdatedFibers(child, counts);
      }
    }

    const renderers = new Map<number, unknown>();
    Reflect.set(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      supportsFiber: true,
      renderers,
      inject(renderer: unknown) {
        const id = renderers.size + 1;
        renderers.set(id, renderer);
        return id;
      },
      onCommitFiberRoot(_rendererId: number, root: { current: Fiber }) {
        const counts: unknown = Reflect.get(globalThis, "__E2E_COMPONENT_RENDERS__");
        if (typeof counts !== "object" || counts === null) return;
        countUpdatedFibers(root.current, counts as Record<string, number>);
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
    });
  });
}

/** Starts a fresh count; commits before this call are not recorded. */
export async function resetComponentRenders(page: Page): Promise<void> {
  await page.evaluate(() => {
    Reflect.set(globalThis, "__E2E_COMPONENT_RENDERS__", {});
  });
}

export async function readComponentRenders(
  page: Page,
  names: readonly string[],
): Promise<Record<string, number>> {
  return await page.evaluate((componentNames) => {
    const counts: unknown = Reflect.get(globalThis, "__E2E_COMPONENT_RENDERS__");
    const source = typeof counts === "object" && counts !== null ? counts : {};
    return Object.fromEntries(
      componentNames.map((name) => [name, Number(Reflect.get(source, name) ?? 0)]),
    );
  }, names);
}
