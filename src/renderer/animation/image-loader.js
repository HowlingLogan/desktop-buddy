export class ImageLoader {
  #images = new Map();

  async preload(urls) {
    const uniqueUrls = [...new Set(urls)];
    await Promise.all(uniqueUrls.map(async (url) => {
      if (this.#images.has(url)) return;
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      await image.decode();
      this.#images.set(url, image);
    }));
  }

  has(url) {
    return this.#images.has(url);
  }
}
