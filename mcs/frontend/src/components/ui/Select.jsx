import { forwardRef } from "react";

export const Select = forwardRef(function Select({
  label,
  error,
  hint,
  className = "",
  id,
  required,
  options = [],
  placeholder,
  ...props
}, ref) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, "-");
  const errorId = error ? `${selectId}-error` : undefined;
  const hintId = hint ? `${selectId}-hint` : undefined;

  return (
    <div className={`ds-field${error ? " ds-field--error" : ""} ${className}`}>
      {label && (
        <label htmlFor={selectId} className="ds-field__label">
          {label}
          {required && <span className="ds-field__required" aria-hidden="true">*</span>}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        className="ds-field__select"
        aria-invalid={error ? "true" : "false"}
        aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
        required={required}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <span id={errorId} className="ds-field__error" role="alert">{error}</span>}
      {hint && !error && <span id={hintId} className="ds-field__hint">{hint}</span>}
    </div>
  );
});

Select.displayName = "Select";