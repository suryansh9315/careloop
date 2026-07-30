/**
 * Pure, dependency-free G.711 μ-law (mu-law) codec.
 *
 * Twilio Media Streams send/receive 8-bit μ-law at 8000 Hz ("PCMU"); Deepgram's
 * Voice Agent is configured for the same encoding, so the bridge only needs μ-law
 * on the wire. These helpers exist so any component that wants linear PCM (e.g. a
 * local VAD, a WAV dump, or a different TTS/STT) can convert without pulling in a
 * native codec.
 *
 * Standard ITU-T G.711 μ-law algorithm, BIAS = 0x84, μ = 255.
 *
 * Unit sanity (round-trip is lossy by design — μ-law is 8-bit companded):
 *   pcm16ToMulaw(Buffer.of(0x00,0x00)) === Buffer.of(0xFF)   // 0     → 0xFF
 *   mulawToPcm16(Buffer.of(0xFF))      ≈  0                    // 0xFF  → ~0
 *   mulawToPcm16(Buffer.of(0x00))      ≈ -32124                // full-scale negative
 */

const BIAS = 0x84; // 132
const CLIP = 32635;

/** Encode one 16-bit signed PCM sample to an 8-bit μ-law byte. */
function encodeSample(sample: number): number {
  // Clamp to 16-bit signed range.
  let s = sample;
  if (s > 32767) s = 32767;
  else if (s < -32768) s = -32768;

  // Get sign bit and magnitude.
  let sign = 0;
  if (s < 0) {
    sign = 0x80;
    s = -s;
  }
  if (s > CLIP) s = CLIP;
  s += BIAS;

  // Find the exponent (position of the highest set bit above the bias).
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent--;
  }

  const mantissa = (s >> (exponent + 3)) & 0x0f;
  const mulaw = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return mulaw;
}

/** Decode one 8-bit μ-law byte to a 16-bit signed PCM sample. */
function decodeSample(mulaw: number): number {
  const u = ~mulaw & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;

  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign ? -sample : sample;
}

/**
 * Decode a μ-law buffer to little-endian 16-bit PCM.
 * Output length = input length * 2.
 */
export function mulawToPcm16(mu: Buffer): Buffer {
  const out = Buffer.allocUnsafe(mu.length * 2);
  for (let i = 0; i < mu.length; i++) {
    out.writeInt16LE(decodeSample(mu[i]!), i * 2);
  }
  return out;
}

/**
 * Encode little-endian 16-bit PCM to a μ-law buffer.
 * Output length = floor(input length / 2). Trailing odd byte (if any) is dropped.
 */
export function pcm16ToMulaw(pcm: Buffer): Buffer {
  const samples = pcm.length >> 1;
  const out = Buffer.allocUnsafe(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = encodeSample(pcm.readInt16LE(i * 2));
  }
  return out;
}
