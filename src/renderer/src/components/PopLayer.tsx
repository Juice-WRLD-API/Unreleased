import { forwardRef, useRef } from 'react'
import { popOut, useExitGhost } from '../hooks/useExitGhost'

// Drop-in <div> for a popover's panel (a dropdown list, a picker, the EQ) that
// fades out when it closes, the way menus do. Render it only while open - its
// unmounting is the close. The entrance stays with the caller (usually
// `animate-menu-pop` on the className).
export const PopLayer = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (props, forwardedRef) => {
    const ownRef = useRef<HTMLDivElement>(null)
    useExitGhost(ownRef, popOut)
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
PopLayer.displayName = 'PopLayer'
