export class AudioEngine {
  private readonly context: AudioContext;
  private readonly cache = new Map<string, AudioBuffer>();

  constructor() {
    this.context = new AudioContext();
  }

  async play(url: string): Promise<void> {
    const safeUrl = `/asset?url=${encodeURIComponent(url)}`;
    const buffer = await this.loadBuffer(safeUrl);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.start();
  }

  async dispose(): Promise<void> {
    if (this.context.state !== "closed") {
      await this.context.close();
    }
  }

  private async loadBuffer(url: string): Promise<AudioBuffer> {
    const cached = this.cache.get(url);
    if (cached) {
      return cached;
    }

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`audio fetch failed: ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
    this.cache.set(url, audioBuffer);
    return audioBuffer;
  }
}