import { createContext, useContext, type ReactNode } from "react";

interface CanvasCtx {
  openPath: () => void;
  openMap: () => void;
  toast: (message: string) => void;
  askBusy?: boolean;
}

export const CanvasContext = createContext<CanvasCtx>({ openPath: () => {}, openMap: () => {}, toast: () => {} });

export function useCanvas(): CanvasCtx {
  return useContext(CanvasContext);
}

export function CanvasProvider({ value, children }: { value: CanvasCtx; children: ReactNode }) {
  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}
