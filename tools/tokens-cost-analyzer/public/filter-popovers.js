// Popover behaviour for the header's filter menus. `<details>` gives us open and
// close for free but nothing else: two menus will happily sit open at once, and
// neither closes when the user looks elsewhere or presses Escape.
//
// The rules live here, behind a `menus()` accessor, so they can be exercised
// without a browser — the DOM wiring in `app.js` stays a one-liner per event.

export function createFilterPopovers({ menus, focusTrigger = () => {} }) {
  const open = () => menus().filter((menu) => menu.open);
  const closeAll = () => {
    const closing = open();
    for (const menu of closing) menu.open = false;
    return closing.length > 0;
  };

  return {
    /** Opening one closes the rest, so the header never stacks two lists. */
    exclusive(opened) {
      let closed = false;
      for (const menu of menus()) {
        if (menu === opened || !menu.open) continue;
        menu.open = false;
        closed = true;
      }
      return closed;
    },

    /** A click anywhere outside the filter menus dismisses them. */
    outsideClick(target) {
      if (menus().some((menu) => menu.contains(target))) return false;
      return closeAll();
    },

    /**
     * Escape closes and hands focus back to the trigger that was opened —
     * leaving focus inside a list that is no longer on screen strands the
     * keyboard user at the top of the document.
     */
    escape() {
      const [opened] = open();
      if (!opened) return false;
      closeAll();
      focusTrigger(opened);
      return true;
    },
  };
}
