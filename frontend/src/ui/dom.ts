export const $ = <T extends Element = HTMLElement>(selector: string): T | null =>
  document.querySelector<T>(selector);

export const $all = <T extends Element = HTMLElement>(selector: string): T[] =>
  Array.from(document.querySelectorAll<T>(selector));

export const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[char] ?? char;
  });

let toastTimer: number | undefined;

export function toast(message: string): void {
  const box = $('#toast');
  if (!box) return;
  box.textContent = message;
  box.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => box.classList.add('hidden'), 4000);
}

export function openModal(title: string, body: string, footer?: string): void {
  const dialog = $('#modal') as HTMLDialogElement | null;
  const titleNode = $('#modalTitle');
  const bodyNode = $('#modalBody');
  const footerNode = $('#modalFooter');
  if (!dialog || !titleNode || !bodyNode || !footerNode) return;
  titleNode.textContent = title;
  bodyNode.innerHTML = body;
  footerNode.innerHTML = footer ?? '<button data-close>关闭</button>';
  if (!dialog.open) dialog.showModal();
}

export function closeModal(): void {
  const dialog = $('#modal') as HTMLDialogElement | null;
  if (dialog?.open) dialog.close();
}

export function confirmAction(
  title: string,
  description: string,
  onConfirm: () => void | Promise<void>,
  confirmLabel = '确认',
): void {
  openModal(
    title,
    `<p>${esc(description)}</p>`,
    `<button data-close>取消</button><button class="primary" id="confirmAction">${esc(confirmLabel)}</button>`,
  );
  const button = $('#confirmAction');
  if (button) {
    button.addEventListener('click', () => {
      closeModal();
      void onConfirm();
    });
  }
}

export function setText(selector: string, value: string): void {
  const node = $(selector);
  if (node) node.textContent = value;
}

export function setHTML(selector: string, value: string): void {
  const node = $(selector);
  if (node) node.innerHTML = value;
}

export function on<T extends Element = HTMLElement>(selector: string, event: string, handler: (target: T, ev: Event) => void): void {
  const node = $(selector);
  node?.addEventListener(event, (ev) => handler(node as unknown as T, ev));
}
