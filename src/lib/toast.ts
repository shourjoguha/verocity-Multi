// Cross-island toast bus: any island calls toast(), the single <Toaster/>
// mounted in Base.astro renders it. Decoupled via a window CustomEvent so
// separate React roots don't need a shared provider.
export type ToastType = 'info' | 'success' | 'error';

export function toast(message: string, type: ToastType = 'info'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('verocity:toast', { detail: { message, type } }));
}
