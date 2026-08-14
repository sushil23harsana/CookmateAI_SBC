'use client';

import { useEffect, useState } from 'react';

/** Registers the service worker. Mounted once from the root layout; renders nothing. */
export default function PwaSetup() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* not fatal — the app just isn't installable/offline-capable this visit */
      });
    }
  }, []);
  return null;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Topbar chip that appears only when the browser offers a real install prompt (Android/desktop Chrome). */
export function InstallChip() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!deferred) return null;
  return (
    <button
      className="install-chip"
      onClick={() => {
        void deferred.prompt();
        void deferred.userChoice.finally(() => setDeferred(null));
      }}
    >
      📲 Install
    </button>
  );
}
