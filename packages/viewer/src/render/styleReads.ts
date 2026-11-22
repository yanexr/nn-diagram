/** Read computed styles together, then commit changes, before the next paint.
 * Interleaving a border-offset write with the next shape's computed-style
 * read otherwise repeatedly flushes layout while mounting nested diagrams.
 */
type Read = () => () => void;
const pending = new Map<HTMLElement, Read>();
let scheduled = false;

export function scheduleStyleRead(element: HTMLElement, read: Read): () => void {
  pending.set(element, read);
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const batch = [...pending];
      pending.clear();
      const commits: (() => void)[] = [];
      for (const [element, read] of batch) if (element.isConnected) commits.push(read());
      for (const commit of commits) commit();
    });
  }
  return () => { if (pending.get(element) === read) pending.delete(element); };
}
