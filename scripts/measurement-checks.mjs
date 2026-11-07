// REQ-015, F069/F072: a loaded extension or navigation-only report is not sensor evidence.
export function positiveCounts(entries, ids) {
  return Array.isArray(entries) && ids.every((id) => entries.some((entry) => entry.techniqueId === id && Number.isFinite(entry.count) && entry.count > 0));
}

export function committedReport(report, ids = ['DET-001', 'DET-002', 'DET-003']) {
  return positiveCounts(report?.counters, ids) && Number.isInteger(report?.watermark?.lastCommittedBatchSeq) && report.watermark.lastCommittedBatchSeq > 0;
}

export function storedReports(dump, depth = 0) {
  if (depth > 12 || !dump || typeof dump !== 'object') return [];
  if (dump.schemaVersion === 1 && typeof dump.documentKey === 'string' && Array.isArray(dump.counters)) return [dump];
  return Object.values(dump).flatMap((child) => storedReports(child, depth + 1));
}

export function perfRunErrors(run) {
  const errors = [];
  for (const phase of ['cold', 'warm']) {
    if (run[phase]?.measureTextCalls !== 1_000_000 || run[phase]?.getImageDataCalls !== 10_000) errors.push(phase + ': incorrect canvas workload');
    for (const metric of ['measureTextMs', 'getImageDataMs', 'totalMs']) {
      if (!Number.isFinite(run[phase]?.[metric]) || run[phase][metric] <= 0) errors.push(phase + '.' + metric + ': timing must be finite and positive');
    }
  }
  if (run.mode === 'with') {
    if (run.observation?.enabled !== true) errors.push('observation is inactive');
    for (const id of ['DET-002', 'DET-003']) {
      if (!Number.isFinite(run.observed?.counts?.[id]) || run.observed.counts[id] <= 0) errors.push('missing positive sensor count: ' + id);
    }
  }
  return errors;
}

export async function waitForEvidence(read, accepts, { timeout = 10_000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  do {
    let timer;
    let value;
    try {
      value = await Promise.race([
        Promise.resolve().then(read),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('measurement evidence missing after bounded wait')), Math.max(0, deadline - Date.now()));
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (accepts(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, interval));
  } while (Date.now() < deadline);
  throw new Error('measurement evidence missing after bounded wait');
}
