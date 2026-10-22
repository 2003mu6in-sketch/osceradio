// Minimal React typings for build boxes without @types/react (see tsconfig.offline.json).
// Real development uses @types/react from package.json; this only lets `tsc` check app logic here.
declare module "react" {
  export type ReactNode = any;
  export type Key = string | number;
  export interface PointerEvent<T = Element> { pointerId: number; clientX: number; clientY: number; target: EventTarget & T; }
  export function useState<T>(init: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void];
  export function useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(fn: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: readonly unknown[]): T;
  export function useRef<T>(init: T): { current: T };
  export function useRef<T>(init: T | null): { current: T | null };
  export function useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, get: () => T): T;
  export function useId(): string;
  export const StrictMode: (p: { children?: ReactNode }) => any;
  export const Fragment: any;
}
declare module "react/jsx-runtime" {
  export const jsx: any; export const jsxs: any; export const Fragment: any;
  export namespace JSX {
    type Element = any;
    interface IntrinsicElements { [tag: string]: any }
    interface IntrinsicAttributes { key?: string | number }
  }
}
declare module "react-dom/client" {
  export function createRoot(el: Element): { render(node: any): void; unmount(): void };
}
declare module "*.css";
