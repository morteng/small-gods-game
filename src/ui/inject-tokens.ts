import tokensCss from './tokens.css?raw';

export function injectTokens(container: HTMLElement): () => void {
  const style = document.createElement('style');
  style.dataset.smallGodsTokens = 'true';
  style.textContent = tokensCss;
  container.appendChild(style);
  return () => style.remove();
}
