import { useEffect, useState } from 'react';
import { applyTheme, getStoredPref, THEME_PREFS, type ThemePref } from '@/lib/theme';
import SegmentedTabs from '@/components/ui/SegmentedTabs';

const LABEL: Record<ThemePref, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

// One value out of three, so it is a segmented radiogroup rather than a row of
// detached buttons. The caller places it (You → Appearance puts it at the right
// of a label row).
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [pref, setPref] = useState<ThemePref>('system');

  useEffect(() => {
    setPref(getStoredPref());
  }, []);

  function pick(p: ThemePref) {
    setPref(p);
    applyTheme(p);
  }

  return (
    <SegmentedTabs
      as="radiogroup"
      size="sm"
      ariaLabel="Theme"
      tabs={THEME_PREFS.map((p) => ({ key: p, label: LABEL[p] }))}
      active={pref}
      onChange={(k) => pick(k as ThemePref)}
      className={className}
    />
  );
}
