// P09 / E02-02. Synthetic local workloads, not fingerprint collectors.
(() => {
  const scenario = document.body.dataset.scenario;
  const mode = globalThis.__mathMode ?? 'baseline';
  const observer = mode === 'baseline' ? null : globalThis.__installMathPrototype(mode);
  const iterations = scenario === 'single' ? 1_000_000 : 100_000;
  const strings = ['0.125', '0.25', '0.5', '0.75'];
  const x = new Float64Array(32);
  const velocity = new Float64Array(32);

  function single(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.sin(i * 0.001);
    return sum;
  }
  function families(n) {
    let sum = 0;
    // Eight families: trig, inverse trig, hyperbolic, inverse hyperbolic, exp, log, power, root.
    for (let i = 0; i < n; i++) {
      const v = (i % 1000) * 0.001;
      sum += Math.sin(v) + Math.asin(v) + Math.sinh(v) + Math.asinh(v) +
        Math.exp(v) + Math.log(1 + v) + Math.pow(1 + v, 1.5) + Math.sqrt(v);
    }
    return sum;
  }
  function calculator(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const input = strings[i % strings.length];
      // Native Math owns string coercion, including pow's second argument.
      sum += Math.sin(input) + Math.cos(input) + Math.log(input) + Math.sqrt(input) + Math.pow(input, '2');
    }
    return sum;
  }
  function physics(n) {
    for (let p = 0; p < x.length; p++) { x[p] = (p + 1) * 0.01; velocity[p] = 0; }
    for (let i = 0; i < n; i++) {
      const p = i % x.length;
      const force = -Math.sin(x[p]) - 0.02 * velocity[p];
      velocity[p] += force * 0.01;
      x[p] += velocity[p] * 0.01;
    }
    let sum = 0;
    for (let p = 0; p < x.length; p++) sum += x[p] + velocity[p];
    return sum;
  }
  function animationKernel() {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += Math.sin(i * 0.01) + Math.cos(i * 0.01);
    return sum;
  }
  function publish(result) {
    // Only the fixture's synthetic checksum leaves the workload; the observer retains no values.
    result.scenario = scenario;
    result.mode = mode;
    result.observed = observer?.snapshot() ?? null;
    document.getElementById('result').textContent = JSON.stringify(result);
  }
  if (scenario === 'animation') {
    animationKernel();
    observer?.reset();
    let start;
    let previous;
    let workMs = 0;
    let frames = 0;
    let checksum = 0;
    const frameIntervalsMs = [];
    function frame(timestamp) {
      start ??= timestamp;
      if (previous !== undefined) frameIntervalsMs.push(timestamp - previous);
      previous = timestamp;
      const before = performance.now();
      checksum = animationKernel();
      workMs += performance.now() - before;
      frames++;
      if (timestamp - start < 5000) requestAnimationFrame(frame);
      else publish({ totalMs: timestamp - start, workMs, frames, frameIntervalsMs, checksum,
        calls: frames * 512, expectedCounts: [frames * 256, frames * 256, 0, 0, 0, 0, 0, 0, 0] });
    }
    requestAnimationFrame(frame);
  } else {
    const workload = { single, families, calculator, physics }[scenario];
    const warmupChecksum = workload(1000);
    observer?.reset();
    const before = performance.now();
    const checksum = workload(iterations);
    const totalMs = performance.now() - before;
    const expectedCounts = {
      single: [iterations, 0, 0, 0, 0, 0, 0, 0, 0],
      families: [iterations, 0, iterations, iterations, iterations, iterations, iterations, iterations, iterations],
      calculator: [iterations, iterations, 0, 0, 0, 0, iterations, iterations, iterations],
      physics: [iterations, 0, 0, 0, 0, 0, 0, 0, 0],
    }[scenario];
    publish({ totalMs, checksum, warmupChecksum, iterations, expectedCounts,
      calls: expectedCounts.reduce((a, b) => a + b, 0) });
  }
})();
