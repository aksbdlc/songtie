import { isTauri } from '@tauri-apps/api/core';
import type { SongtieRepository } from '../../application';
import { BrowserSongtieRepository } from './browser-repository';
import { TauriSongtieRepository } from './tauri-repository';

export function isDesktopRuntime(): boolean {
  return isTauri();
}

export function createRepository(): SongtieRepository {
  return isDesktopRuntime() ? new TauriSongtieRepository() : new BrowserSongtieRepository();
}

export { TauriSongtieRepository, type TauriStatePayload } from './tauri-repository';
