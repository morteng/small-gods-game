import tokensCss from './tokens.css?raw';

/** The active UI skin. Each maps to a `.sg-theme-<name>` block in tokens.css. */
export type UiTheme = 'dark' | 'light';

/**
 * Inject the shared design tokens and apply a skin to the game container.
 *
 * Tokens live on `:root` (the light palette + structural scale); each skin is a
 * `.sg-theme-<name>` class that overrides the colour tokens. Applying the class
 * to the container means every token-driven component inside it re-skins at
 * once — that's what makes the UI skinnable. `'dark'` is the default game skin;
 * `'light'` is just the bare `:root` palette (no override class).
 */
export function injectTokens(container: HTMLElement, theme: UiTheme = 'dark'): () => void {
  const style = document.createElement('style');
  style.dataset.smallGodsTokens = 'true';
  style.textContent = tokensCss;
  container.appendChild(style);

  const themeClass = theme === 'light' ? null : `sg-theme-${theme}`;
  if (themeClass) container.classList.add(themeClass);

  return () => {
    style.remove();
    if (themeClass) container.classList.remove(themeClass);
  };
}
