/* eslint-disable react-refresh/only-export-components -- provider and its typed hook form one public boundary */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { SongtieService, type SaveNoteInput, type SongtieSnapshot } from '../application';
import { NOTE_DIMENSIONS, type DrawingScene, type Note, type Point } from '../domain';
import {
  createRepository,
  isDesktopRuntime,
  TauriSongtieRepository,
  type TauriStatePayload,
} from '../adapters/persistence';

type SongtieContextValue = {
  snapshot: SongtieSnapshot | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  clearError: () => void;
  reload: () => Promise<void>;
  captureQuick: (text: string) => Promise<Note>;
  createWallNote: () => Promise<Note>;
  moveNote: (id: string, point: Point) => Promise<void>;
  saveNote: (input: SaveNoteInput) => Promise<void>;
  saveWall: (scene: DrawingScene) => Promise<void>;
  completeNote: (id: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
};

const SongtieContext = createContext<SongtieContextValue | null>(null);

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '刚才没有保存成功。内容还在，请再试一次。';
}

function wallBounds() {
  const width = Math.max(window.screen?.width ?? 0, window.innerWidth, NOTE_DIMENSIONS.L.width);
  const height = Math.max(window.screen?.height ?? 0, window.innerHeight, NOTE_DIMENSIONS.L.height);
  return { width, height };
}

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `note-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function snapshotRevisionKey(value: SongtieSnapshot): string {
  return [
    value.wall.revision,
    ...value.notes.map((note) => `${note.id}:${note.revision}`),
    '|completed|',
    ...value.completedNotes.map((note) => `${note.id}:${note.completedOn}:${note.completedOrder}`),
  ].join('|');
}

export function SongtieProvider({ children }: { children: ReactNode }) {
  const repository = useMemo(() => createRepository(), []);
  const service = useMemo(
    () => new SongtieService(repository, { now: () => new Date() }, { nextId: randomId }),
    [repository],
  );
  const [snapshot, setSnapshot] = useState<SongtieSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingCount, setSavingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const operationQueue = useRef<Promise<void>>(Promise.resolve());
  const currentSnapshotKey = useRef<string | null>(null);

  const syncSnapshot = useCallback(async () => {
    const next = await service.getSnapshot();
    const key = snapshotRevisionKey(next);
    if (mounted.current && currentSnapshotKey.current !== key) {
      currentSnapshotKey.current = key;
      setSnapshot(next);
    }
  }, [service]);

  const reload = useCallback(async () => {
    if (repository instanceof TauriSongtieRepository) await repository.refresh();
    await syncSnapshot();
  }, [repository, syncSnapshot]);

  const run = useCallback(
    <T,>(operation: () => Promise<T>): Promise<T> => {
      setSavingCount((count) => count + 1);
      setError(null);

      // Every mutation reads the current revision before writing. Keeping the
      // operations in one queue prevents two quick gestures from racing with
      // the same revision while still letting the interface stay responsive.
      const result = operationQueue.current
        .catch(() => undefined)
        .then(async () => {
          const value = await operation();
          await syncSnapshot();
          return value;
        });

      operationQueue.current = result.then(
        () => undefined,
        () => undefined,
      );

      return result
        .catch((caught: unknown) => {
          setError(errorMessage(caught));
          throw caught;
        })
        .finally(() => setSavingCount((count) => Math.max(0, count - 1)));
    },
    [syncSnapshot],
  );

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const current = await repository.getWall();
        if (current === null) await service.initializeWall(wallBounds());
        await reload();
      } catch (caught) {
        if (mounted.current) setError(errorMessage(caught));
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();

    return () => {
      mounted.current = false;
    };
  }, [reload, repository, service]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<TauriStatePayload>('state-changed', (event) => {
      if (disposed) return;
      if (repository instanceof TauriSongtieRepository) repository.acceptState(event.payload);
      void syncSnapshot().catch((caught: unknown) => setError(errorMessage(caught)));
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [repository, syncSnapshot]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen('state-invalidated', () => {
      if (!disposed) void reload().catch((caught: unknown) => setError(errorMessage(caught)));
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [reload]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<{ token: string }>('flush-request', (event) => {
      // Draft-owning child components receive the same event and enqueue their
      // last scene synchronously. Waiting until the next task observes those
      // enqueues before acknowledging the desktop shell.
      window.setTimeout(() => {
        if (disposed) return;
        void operationQueue.current.then(() =>
          emit('flush-complete', { token: event.payload.token }),
        );
      }, 0);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  const value = useMemo<SongtieContextValue>(
    () => ({
      snapshot,
      loading,
      saving: savingCount > 0,
      error,
      clearError: () => setError(null),
      reload,
      captureQuick: (text) => run(() => service.captureQuickNote(text)),
      createWallNote: () => run(() => service.createWallNote()),
      moveNote: async (id, point) => {
        await run(() => service.moveNote(id, point));
      },
      saveNote: async (input) => {
        await run(() => service.saveNote(input));
      },
      saveWall: async (scene) => {
        await run(() => service.saveWallScene(scene));
      },
      completeNote: async (id) => {
        await run(() => service.completeNote(id));
      },
      deleteNote: async (id) => {
        await run(() => service.deleteNote(id));
      },
    }),
    [error, loading, reload, run, savingCount, service, snapshot],
  );

  return <SongtieContext.Provider value={value}>{children}</SongtieContext.Provider>;
}

export function useSongtie(): SongtieContextValue {
  const context = useContext(SongtieContext);
  if (!context) throw new Error('useSongtie 必须在 SongtieProvider 中使用。');
  return context;
}
