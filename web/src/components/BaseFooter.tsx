import { BaseBottomNav } from "./BaseBottomNav";

/** koi.fun has no traditional footer — the fixed bottom navigation is the
 *  persistent chrome, matching the mobile-first discovery layout. */
export function BaseFooter() {
  return <BaseBottomNav />;
}
