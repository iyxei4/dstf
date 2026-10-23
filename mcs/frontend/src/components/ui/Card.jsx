import { forwardRef } from "react";

export const Card = forwardRef(function Card({
  children,
  className = "",
  variant = "default",
  padding = "md",
  hoverable = false,
  ...props
}, ref) {
  return (
    <article
      ref={ref}
      className={`ds-card ds-card--${variant} ds-card--${padding}${hoverable ? " ds-card--hoverable" : ""} ${className}`}
      {...props}
    >
      {children}
    </article>
  );
});

Card.displayName = "Card";

export const CardHeader = forwardRef(function CardHeader({ children, className = "", ...props }, ref) {
  return (
    <header ref={ref} className={`ds-card__header ${className}`} {...props}>
      {children}
    </header>
  );
});

CardHeader.displayName = "CardHeader";

export const CardBody = forwardRef(function CardBody({ children, className = "", ...props }, ref) {
  return (
    <div ref={ref} className={`ds-card__body ${className}`} {...props}>
      {children}
    </div>
  );
});

CardBody.displayName = "CardBody";

export const CardFooter = forwardRef(function CardFooter({ children, className = "", ...props }, ref) {
  return (
    <footer ref={ref} className={`ds-card__footer ${className}`} {...props}>
      {children}
    </footer>
  );
});

CardFooter.displayName = "CardFooter";