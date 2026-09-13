import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ActiveWall } from '../features/active-wall/ActiveWall';
import { CompletionWall } from '../features/completion-wall/CompletionWall';
import { QuickCapture } from '../features/quick-capture/QuickCapture';
import { isDesktopRuntime } from '../adapters/persistence';
import { SongtieProvider, useSongtie } from './songtie-context';

type MainRoute = 'wall' | 'completed';

function StartupView() {
  const { loading, error } = useSongtie();
  if (!loading && error) {
    return (
      <main className="startup-screen startup-screen--error">
        <span>这次没有打开</span>
        <p>{error}</p>
      </main>
    );
  }
  return (
    <main className="startup-screen">
      <span className="breathing-dot" />
      <p>正在铺开墙面…</p>
    </main>
  );
}

function MainWindow() {
  const { snapshot, loading } = useSongtie();
  const [route, setRoute] = useState<MainRoute>('wall');

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let stop: (() => void) | undefined;
    let disposed = false;
    void listen<string>('navigate', (event) => {
      if (event.payload === 'wall' || event.payload === 'completed') setRoute(event.payload);
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);

  if (loading || !snapshot) return <StartupView />;
  return route === 'completed' ? (
    <CompletionWall onBack={() => setRoute('wall')} />
  ) : (
    <ActiveWall onOpenCompleted={() => setRoute('completed')} />
  );
}

export function App() {
  const params = new URLSearchParams(window.location.search);
  const isQuickCapture = params.get('window') === 'quick-capture';

  if (isQuickCapture) return <QuickCapture />;
  return (
    <SongtieProvider>
      <MainWindow />
    </SongtieProvider>
  );
}
