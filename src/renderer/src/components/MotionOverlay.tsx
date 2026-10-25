import { forwardRef, useRef } from 'react'
import { useOverlayMotion } from '../hooks/useOverlayMotion'

// Drop-in <div> for a hand-rolled modal's full-window root (the `fixed
// inset-0` scrim) that gives it the same open/close motion as ModalOverlay -
// see useOverlayMotion. The dialog must be the root's last child.
export const MotionOverlay = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (props, forwardedRef) => {
    const ownRef = useRef<HTMLDivElement>(null)
    useOverlayMotion(ownRef)
    return (
      <div
        {...props}
        ref={(el) => {
          ;(ownRef as React.MutableRefObject<HTMLDivElement | null>).current = el
          if (typeof forwardedRef === 'function') forwardedRef(el)
          else if (forwardedRef) forwardedRef.current = el
        }}
      />
    )
  }
)
MotionOverlay.displayName = 'MotionOverlay'
