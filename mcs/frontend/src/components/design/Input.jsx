import { forwardRef } from "react";

export const Input = forwardRef(function Input({
  label,
  error,
  hint,
  icon,
  rightIcon,
  className = "",
  id,
  required,
  type = "text",
  ...props
}, ref) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint ? `${inputId}-hint` : undefined;

  const input = (
    <input
      ref={ref}
      id={inputId}
      type={type}
      className="ds-field__input"
      aria-invalid={error ? "true" : "false"}
      aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
      required={required}
      {...props}
    />
  );

  return (
    <div className={`ds-field${error ? " ds-field--error" : ""} ${className}`}>
      {label && (
        <label htmlFor={inputId} className="ds-field__label">
          {label}
          {required && <span className="ds-field__required" aria-hidden="true">*</span>}
        </label>
      )}
      {icon || rightIcon ? (
        <span
          className={`ds-field__control${icon ? " has-leading" : ""}${
            rightIcon ? " has-trailing" : ""
          }`}
        >
          {icon && <span className="ds-field__icon" aria-hidden="true">{icon}</span>}
          {input}
          {rightIcon && <span className="ds-field__icon ds-field__icon--right">{rightIcon}</span>}
        </span>
      ) : (
        input
      )}
      {error && <span id={errorId} className="ds-field__error" role="alert">{error}</span>}
      {hint && !error && <span id={hintId} className="ds-field__hint">{hint}</span>}
    </div>
  );
});

Input.displayName = "Input";