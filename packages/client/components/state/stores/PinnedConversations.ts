import { State } from "..";

import { AbstractStore } from ".";
import { cleanPinnedIds } from "./pinOrder";

export interface TypePinnedConversations {
  /**
   * IDs of pinned DMs and group DMs, oldest pin first
   */
  ids: string[];

  /**
   * Whether the pin stack on the rail is collapsed (default: collapsed)
   */
  collapsed?: boolean;
}

/**
 * Conversations pinned to the server rail.
 *
 * Kept in its own synced key, not inside `ordering`, because clients without
 * this feature write the whole `ordering` key back and would drop the pins.
 */
export class PinnedConversations extends AbstractStore<
  "pinned-conversations",
  TypePinnedConversations
> {
  /**
   * Construct store
   * @param state State
   */
  constructor(state: State) {
    super(state, "pinned-conversations");
    this.pin = this.pin.bind(this);
    this.unpin = this.unpin.bind(this);
    this.toggle = this.toggle.bind(this);
  }

  /**
   * Get this store's value
   *
   * Reexported to allow equals checking for syncing
   */
  get() {
    return super.get();
  }

  /**
   * Hydrate external context
   */
  hydrate(): void {
    /** nothing needs to be done */
  }

  /**
   * Generate default values
   */
  default(): TypePinnedConversations {
    return { ids: [] };
  }

  /**
   * Validate the given data to see if it is compliant and return a compliant object
   */
  clean(input: Partial<TypePinnedConversations>): TypePinnedConversations {
    const ids = cleanPinnedIds(input.ids);
    return typeof input.collapsed === "boolean"
      ? { ids, collapsed: input.collapsed }
      : { ids };
  }

  /**
   * Pinned conversation IDs, oldest pin first
   */
  list(): string[] {
    return this.get().ids;
  }

  /**
   * Whether a conversation is pinned
   * @param id Channel id
   */
  isPinned(id: string): boolean {
    return this.list().includes(id);
  }

  /**
   * Pin a conversation at the bottom of the pinned group
   * @param id Channel id
   */
  pin(id: string) {
    if (!this.isPinned(id)) this.set("ids", [...this.list(), id]);
  }

  /**
   * Unpin a conversation
   * @param id Channel id
   */
  unpin(id: string) {
    this.set(
      "ids",
      this.list().filter((pinned) => pinned !== id),
    );
  }

  /**
   * Whether the pin stack is collapsed, true unless the user expanded it
   */
  isCollapsed(): boolean {
    return this.get().collapsed ?? true;
  }

  /**
   * Collapse or expand the pin stack
   */
  toggle() {
    this.set("collapsed", !this.isCollapsed());
  }
}
