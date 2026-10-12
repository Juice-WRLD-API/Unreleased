// Browser page translation (Chrome's built-in Google Translate, auto-on for
// many Android users) rewrites text nodes in place, swapping each for a
// <font> wrapper React knows nothing about. React still holds references to
// the original text nodes, so its next commit calls insertBefore/removeChild
// with a node that is no longer a child of the parent and throws
// NotFoundError, unmounting the subtree into an ErrorBoundary card (and the
// card itself can hit the same error while it updates).
//
// Standard workaround (facebook/react#11538): when the reference node has
// been moved out from under the parent, fall back to a harmless equivalent -
// append instead of insert, skip a removal of a node that's already gone.
// The translated text may end up slightly out of order until the next
// re-render, which beats a crash.
export function installTranslateDomGuard(): void {
  if (typeof Node !== 'function' || !Node.prototype) return
  const proto = Node.prototype as Node & { __translateGuard?: boolean }
  if (proto.__translateGuard) return
  proto.__translateGuard = true

  const removeChild = proto.removeChild
  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      console.warn('Skipped removeChild of a node from a different parent (page translation?)', child)
      return child
    }
    return removeChild.call(this, child) as T
  }

  const insertBefore = proto.insertBefore
  proto.insertBefore = function <T extends Node>(this: Node, newNode: T, referenceNode: Node | null): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      console.warn('insertBefore reference node is not a child (page translation?) - appending instead', referenceNode)
      return this.appendChild(newNode)
    }
    return insertBefore.call(this, newNode, referenceNode) as T
  }
}
