import React, { useRef } from 'react';
import type { Settings } from '../../types';
import { validateSettings } from '../../schema';

interface Props {
  settings: Settings;
  onImport: (s: Settings) => Promise<void>;
  showToast: (msg: string, kind: 'success' | 'error') => void;
}

export function ImportExportSection({
  settings,
  onImport,
  showToast,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'screener-settings.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleImportClick = () => {
    fileRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const obj = JSON.parse(text) as unknown;
      const { errors } = validateSettings(obj);
      if (errors.length > 0) {
        showToast(
          'Invalid settings:\n' +
            errors
              .map((err) => `${err.path}: ${err.message}`)
              .join('\n'),
          'error',
        );
        return;
      }
      if (
        !confirm(
          'This will replace all your current schedules and provider settings. Continue?',
        )
      )
        return;
      await onImport(obj as Settings);
      showToast('Settings imported and saved.', 'success');
    } catch {
      showToast('Could not parse the file as JSON.', 'error');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div id="io-controls">
      <button onClick={handleExport}>Export</button>
      <button onClick={handleImportClick}>Import</button>
      <input
        ref={fileRef}
        type="file"
        id="io-file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  );
}