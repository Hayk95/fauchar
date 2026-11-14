export {};

declare global {
  interface Window {
    FaucharViewer?: new (canvas: HTMLCanvasElement, options?: Record<string, unknown>) => {
      dispose?: () => void;
      [key: string]: unknown;
    };
    __fauchar_landing_booted?: boolean;
    __fauchar_cad_booted?: boolean;
    __fauchar_viewer_booted?: boolean;
    __fauchar_workspaceApp_booted?: boolean;
  }
}
