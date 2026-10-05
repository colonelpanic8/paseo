/**
 * Maps with a bounded number of in-flight operations, preserving input order. A scan touches
 * thousands of files; awaiting them one at a time leaves the disk idle, and awaiting them all at
 * once opens thousands of handles.
 */
export async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  map: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const results = Array.from<Output>({ length: items.length });
  const queue = items.map((item, index) => async () => {
    results[index] = await map(item, index);
  });
  let next = 0;

  async function worker(): Promise<void> {
    for (let task = queue[next++]; task !== undefined; task = queue[next++]) {
      await task();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return results;
}
