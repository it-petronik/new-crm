import type { Viewport } from "next";

/** Desktop workspace on phones, as requested. A wide layout viewport keeps
 * the existing desktop sidebar, grids and table columns across every module.
 * Let the browser fit that desktop canvas to the phone initially; pinch zoom
 * and panning remain available, including access to fixed desktop toolbars.
 * Authentication and public meeting pages retain the root device viewport.
 */
export const desktopWorkspaceViewport: Viewport = {
  width: 1280,
  initialScale: undefined,
  userScalable: true,
};
