import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isDesktopRuntime } from '../persistence';

export type MainRoute = 'wall' | 'completed';

export async function hideCurrentWindow(): Promise<void> {
  if (!isDesktopRuntime()) return;
  await getCurrentWindow().hide();
}

export async function showQuickCapture(): Promise<void> {
  if (!isDesktopRuntime()) {
    window.dispatchEvent(new CustomEvent('songtie:quick-preview'));
    return;
  }
  await invoke('show_quick_capture');
}

export async function showMain(route: MainRoute): Promise<void> {
  if (!isDesktopRuntime()) return;
  await invoke('show_main', { route });
}
