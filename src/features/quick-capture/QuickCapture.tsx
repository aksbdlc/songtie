import { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Feather, X } from 'lucide-react';
import { DomainError, type NoteSize } from '../../domain';
import { hideCurrentWindow } from '../../adapters/desktop';
import { classifyQuickTextForDisplay, createQuickCaptureAction } from './quick-capture-service';

const SIZE_NAMES: Record<NoteSize, string> = {
  S: '小纸片',
  M: '中纸片',
  L: '大纸片',
};

function previewSize(text: string): NoteSize | 'too-long' | null {
  if (!text.trim()) return null;
  try {
    return classifyQuickTextForDisplay(text).size;
  } catch (error) {
    if (error instanceof DomainError && error.code === 'QUICK_TEXT_TOO_LONG') return 'too-long';
    return null;
  }
}

export function QuickCapture() {
  const captureQuick = useMemo(() => createQuickCaptureAction(), []);
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);
  const size = useMemo(() => previewSize(text), [text]);

  useEffect(() => {
    const focus = () => requestAnimationFrame(() => input.current?.focus());
    focus();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);

  const save = async () => {
    if (!text.trim() || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      await captureQuick(text);
      setText('');
      await hideCurrentWindow();
    } catch (error) {
      if (error instanceof DomainError) setMessage(error.message.trim());
      else setMessage('没能贴上墙。内容还在，请再试一次。');
      input.current?.focus();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <main className="quick-capture" aria-label="随手贴">
      <header className="quick-capture__header" data-tauri-drag-region>
        <span className="quick-capture__mark" aria-hidden="true">
          <Feather size={17} />
        </span>
        <div>
          <strong>想到什么，先放这里</strong>
          <span>记录不是承诺</span>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="收起随手贴"
          onClick={() => void hideCurrentWindow()}
        >
          <X size={18} />
        </button>
      </header>

      <textarea
        ref={input}
        value={text}
        aria-label="写下突然冒出的想法"
        placeholder="写下来，然后继续刚才的事……"
        spellCheck={false}
        disabled={saving}
        onChange={(event) => {
          setText(event.target.value);
          setMessage(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            void hideCurrentWindow();
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void save();
          }
        }}
      />

      <footer className="quick-capture__footer">
        <div className={`paper-preview paper-preview--${size ?? 'empty'}`}>
          {size === 'too-long'
            ? '放不进大纸片'
            : size
              ? `会变成${SIZE_NAMES[size]}`
              : '会自动选择纸片大小'}
        </div>
        <div className="quick-capture__actions">
          {message && <p role="alert">{message}</p>}
          <span className="key-hint">Ctrl + Enter</span>
          <button
            type="button"
            className="primary-button"
            disabled={!text.trim() || saving}
            onClick={() => void save()}
          >
            {saving ? '正在贴…' : '贴上去'}
            <CornerDownLeft size={16} />
          </button>
        </div>
      </footer>
    </main>
  );
}
