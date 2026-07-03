import { $ } from '../dom';

export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function applyTheme(t: 'dark' | 'light'): void {
  document.documentElement.setAttribute('data-theme', t);
  try {
    localStorage.setItem('bis-log-theme', t);
  } catch {
    /* localStorage may be unavailable (e.g. private browsing) — theme just won't persist */
  }
  const themeBtn = $('themeToggle');
  themeBtn.setAttribute('aria-label', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}

export function wireTheme(): void {
  const themeBtn = $('themeToggle');
  let storedTheme: string | null = null;
  try {
    storedTheme = localStorage.getItem('bis-log-theme');
  } catch {
    /* localStorage may be unavailable */
  }
  applyTheme((storedTheme as 'dark' | 'light' | null) || (systemPrefersDark() ? 'dark' : 'light'));
  themeBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || (systemPrefersDark() ? 'dark' : 'light');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
}
