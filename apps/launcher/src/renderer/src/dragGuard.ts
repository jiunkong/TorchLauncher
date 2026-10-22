interface Guardable {
  addEventListener(type: string, listener: (event: GuardEvent) => void): void;
}
interface GuardEvent {
  type: string;
  preventDefault(): void;
}

/** The launcher has no drop target: files or text dropped on the window must not navigate. */
export function installDragGuard(target: Guardable): void {
  const block = (event: GuardEvent) => event.preventDefault();
  for (const type of ['dragover', 'drop', 'dragstart']) target.addEventListener(type, block);
}
