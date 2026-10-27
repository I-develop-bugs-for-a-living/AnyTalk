import { styled } from "styled-system/jsx";

/**
 * Plain, natively styled controls of the live view. They use no components
 * from the design system on purpose: those listen through Solid's delegated
 * events, which never fire in the inspector's own window.
 */

/** Pill shaped button: filter chips and toolbar buttons (selected = tonal) */
export const Pill = styled("button", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    minHeight: "36px",
    paddingInline: "14px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "var(--borderRadius-full)",
    background: "transparent",
    color: "var(--md-sys-color-on-surface-variant)",
    font: "inherit",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "var(--transitions-fast) background",

    "&:hover": {
      background: "var(--md-sys-color-surface-container-high)",
    },
    "&[aria-pressed='true']": {
      background: "var(--md-sys-color-secondary-container)",
      borderColor: "transparent",
      color: "var(--md-sys-color-on-secondary-container)",
    },
    _focusVisible: {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "2px",
    },
    "&:disabled": { opacity: 0.5, cursor: "default" },
    _phone: { minHeight: "44px" },
  },
  variants: {
    kind: {
      filled: {
        background: "var(--md-sys-color-primary)",
        color: "var(--md-sys-color-on-primary)",
        borderColor: "transparent",
        "&:hover": { background: "var(--md-sys-color-primary)", opacity: 0.9 },
      },
      tonal: {
        background: "var(--md-sys-color-secondary-container)",
        color: "var(--md-sys-color-on-secondary-container)",
        borderColor: "transparent",
        "&:hover": {
          background: "var(--md-sys-color-secondary-container)",
          opacity: 0.9,
        },
      },
      plain: {},
    },
  },
});

/** Text input of the filter */
export const SearchInput = styled("input", {
  base: {
    flex: "1 1 160px",
    minWidth: 0,
    minHeight: "36px",
    paddingInline: "14px",
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "var(--borderRadius-full)",
    background: "var(--md-sys-color-surface-container)",
    color: "var(--md-sys-color-on-surface)",
    font: "inherit",
    fontSize: "14px",

    "&::placeholder": { color: "var(--md-sys-color-on-surface-variant)" },
    "&:focus-visible": {
      outline: "2px solid var(--md-sys-color-primary)",
      outlineOffset: "1px",
    },
    _phone: { minHeight: "44px" },
  },
});

/** Label around a native checkbox, tall enough to tap */
export const CheckLabel = styled("label", {
  base: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "36px",
    cursor: "pointer",
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface)",

    "& input": {
      width: "18px",
      height: "18px",
      accentColor: "var(--md-sys-color-primary)",
    },
    _phone: { minHeight: "44px" },
  },
});
