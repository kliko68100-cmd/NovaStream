/**
 * Jobs — Désactivé (pas de Redis/BullMQ requis sur Render free)
 * Les données sont chargées à la demande avec cache en mémoire
 */

export function initJobs(): void {
  console.log('ℹ️  Jobs background désactivés (mode sans Redis)');
}

export function stopJobs(): Promise<void> {
  return Promise.resolve();
}
