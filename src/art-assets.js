'use strict';

// Original artwork is bundled locally; a failed decode keeps startup retryable.
const ART_FILE = 'assets/art/storybook.png';
const ART_SIZE = 1254;
const ART_MEMORY_LIMIT = 16 * 1024 * 1024;
const ART_FRAMES = Object.freeze({
  courier: [60, 0, 240, 313], courierWalkA: [365, 0, 245, 313],
  courierWalkB: [675, 0, 250, 313], courierWin: [984, 0, 268, 313],
  echo: [56, 327, 268, 295], echoWalkA: [332, 327, 316, 295],
  echoWalkB: [645, 327, 311, 295], echoWin: [954, 327, 298, 295],
  office: [12, 628, 330, 312], tree: [358, 623, 291, 318],
  lantern: [734, 627, 212, 314], supply: [970, 658, 282, 275],
  rocks: [27, 955, 297, 283], paving: [344, 1004, 292, 211],
  sign: [687, 950, 270, 300], flowers: [988, 958, 252, 287]
});
Object.values(ART_FRAMES).forEach(Object.freeze);

function createArtAssets(platform) {
  let atlas = null, pending = null, sprites = null;
  return {
    get ready() { return atlas !== null; },
    get decodedBytes() { return atlas ? atlas.width * atlas.height * 4 : 0; },
    get(id) { return sprites && Object.prototype.hasOwnProperty.call(sprites, id) ? sprites[id] : null; },
    load() {
      if (atlas) return Promise.resolve();
      if (pending) return pending;
      const loading = new Promise((resolve, reject) => {
        let image, timer, settled = false;
        const finish = error => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          if (image) { image.onload = null; image.onerror = null; }
          if (error) reject(error);
          else {
            atlas = image;
            sprites = Object.fromEntries(Object.entries(ART_FRAMES).map(([id, rect]) => [id, { image: atlas, rect }]));
            resolve();
          }
        };
        try {
          image = platform.createImage();
          image.onload = () => {
            if (image.width !== ART_SIZE || image.height !== ART_SIZE || image.width * image.height * 4 > ART_MEMORY_LIMIT) {
              finish(new Error('插画尺寸不正确，请重新加载')); return;
            }
            finish();
          };
          image.onerror = () => finish(new Error('插画未能加载，请重试'));
          timer = setTimeout(() => finish(new Error('插画加载超时，请重试')), 15000);
          image.src = ART_FILE;
        } catch (error) { finish(error); }
      });
      pending = loading.then(() => { pending = null; }, error => { pending = null; throw error; });
      return pending;
    }
  };
}

module.exports = { ART_FILE, ART_SIZE, ART_FRAMES, ART_MEMORY_LIMIT, createArtAssets };
