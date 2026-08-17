/**
 * AudioWorklet processor that downsamples mic input to 16 kHz mono Int16
 * PCM (little-endian) and posts ~100 ms chunks to the main thread.
 *
 * Backboard's realtime STT (`scribe_v2_realtime`) expects PCM at exactly
 * this format. The worklet runs off the main thread so capture stays
 * smooth even when the React tree is busy.
 */
class PcmDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    // Target rate fixed at 16 kHz. We don't expose a knob because Backboard
    // pairs sample_rate with audio_format and only "pcm_16000" / "pcm_8000"
    // are accepted — we lock to 16k for fidelity.
    this.targetRate = 16000;
    // Source rate is the AudioContext rate — typically 48000 on macOS /
    // Linux, 44100 on some Windows machines. Pulled from the worklet's
    // globalThis.sampleRate which is set by the host AudioContext.
    this.sourceRate = opts.sourceRate || sampleRate;
    this.ratio = this.sourceRate / this.targetRate;

    // Emit chunks of roughly 100 ms (1600 samples @ 16 kHz). Backboard
    // accepts 50-200 ms; 100 ms balances latency vs frame overhead.
    this.outChunkSamples = Math.round(this.targetRate * 0.1);
    this.outBuffer = new Int16Array(this.outChunkSamples);
    this.outOffset = 0;

    // Fractional source-sample accumulator for nearest-neighbour decimation.
    // Linear interp would be slightly higher quality but for 48k→16k the
    // difference at speech bandwidth is inaudible and not worth the cost.
    this.sourceCursor = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    while (this.sourceCursor < channel.length) {
      const idx = Math.floor(this.sourceCursor);
      // Clamp + convert Float32 [-1, 1] to Int16 [-32768, 32767].
      const sample = Math.max(-1, Math.min(1, channel[idx]));
      this.outBuffer[this.outOffset++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.sourceCursor += this.ratio;

      if (this.outOffset >= this.outChunkSamples) {
        // postMessage with transferable so we don't allocate a new buffer
        // on the main thread side.
        const out = this.outBuffer.buffer;
        this.port.postMessage(out, [out]);
        this.outBuffer = new Int16Array(this.outChunkSamples);
        this.outOffset = 0;
      }
    }
    // Rebase the cursor relative to the next input block so we don't lose
    // sub-sample precision across `process()` calls.
    this.sourceCursor -= channel.length;
    return true;
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
