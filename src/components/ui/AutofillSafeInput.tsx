'use client'

import { forwardRef, useCallback, useState } from 'react'

const AUTOFILL_SELECTOR = ':-webkit-autofill'
const AUTOFILL_ANIMATION_NAME = 'autofill-detect'

export type AutofillSafeInputProps = React.InputHTMLAttributes<HTMLInputElement>

export const AutofillSafeInput = forwardRef<HTMLInputElement, AutofillSafeInputProps>(
  function AutofillSafeInput(
    { readOnly, onFocus, onPointerDown, onAnimationStart, ...rest },
    ref
  ): React.JSX.Element {
    const [unlocked, setUnlocked] = useState(false)

    const unlock = useCallback((): void => {
      setUnlocked(true)
    }, [])

    const handleFocus = (event: React.FocusEvent<HTMLInputElement>): void => {
      unlock()
      onFocus?.(event)
    }

    const handlePointerDown = (event: React.PointerEvent<HTMLInputElement>): void => {
      unlock()
      onPointerDown?.(event)
    }

    const handleAnimationStart = (event: React.AnimationEvent<HTMLInputElement>): void => {
      if (event.animationName === AUTOFILL_ANIMATION_NAME) {
        const target = event.currentTarget
        if (target.matches(AUTOFILL_SELECTOR) && target.value) {
          target.dispatchEvent(new Event('input', { bubbles: true }))
        }
      }
      onAnimationStart?.(event)
    }

    return (
      <input
        {...rest}
        ref={ref}
        readOnly={readOnly || !unlocked}
        onFocus={handleFocus}
        onPointerDown={handlePointerDown}
        onAnimationStart={handleAnimationStart}
      />
    )
  }
)
