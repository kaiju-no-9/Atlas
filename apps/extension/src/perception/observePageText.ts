/** This self-contained function runs in Chrome's isolated world on user-invoked tabs. */
export function observePageText(): string {
  return (document.body?.innerText ?? "").slice(0, 5000);
}
