import { forwardRef } from "react";

export const Button = forwardRef(function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  disabled,
  loading,
  leftIcon,
  rightIcon,
  fullWidth = false,
  type = "button",
  ...props
}, ref) {
  const baseClasses = [
    "ds-btn",
    `ds-btn--${variant}`,
    `ds-btn--${size}`,
    fullWidth ? "ds-btn--full" : "",
    disabled || loading ? "ds-btn--disabled" : "",
    className
  ].filter(Boolean).join(" ");

  return (
    <button
      ref={ref}
      type={type}
      className={baseClasses}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading && <span className="ds-btn__spinner" aria-hidden="true" />}
      {!loading && leftIcon && <span className="ds-btn__icon ds-btn__icon--left" aria-hidden="true">{leftIcon}</span>}
      <span className="ds-btn__text">{children}</span>
      {!loading && rightIcon && <span className="ds-btn__icon ds-btn__icon--right" aria-hidden="true">{rightIcon}</span>}
    </button>
  );
});

Button.displayName = "Button";