import { styled } from "styled-system/jsx";

/**
 * Building blocks shared by stream and call recaps
 */

export const Tiles = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    gap: "var(--gap-md)",
  },
});

export const Tile = styled("div", {
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--gap-xs)",
    padding: "var(--gap-md)",
    borderRadius: "var(--borderRadius-lg)",
    background: "var(--md-sys-color-surface-container)",
  },
});

export const TileLabel = styled("span", {
  base: {
    fontSize: "12px",
    color: "var(--md-sys-color-on-surface-variant)",
  },
});

export const TileValue = styled("span", {
  base: {
    fontSize: "18px",
    fontWeight: 600,
    color: "var(--md-sys-color-on-surface)",
  },
});

export const InfoGrid = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    alignItems: "baseline",
    columnGap: "var(--gap-lg)",
    rowGap: "var(--gap-xs)",
    fontSize: "13px",
    color: "var(--md-sys-color-on-surface)",
  },
});

export const Charts = styled("div", {
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: "var(--gap-md)",
  },
});
