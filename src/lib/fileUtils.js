const MAX_IMG_KB = 180;
const MAX_IMG_WIDTH = 1400;
export const MAX_IMAGES_PER_TXN = 5;
export const MAX_PDF_KB = 700;

export const compressImage = (file, maxWidth = MAX_IMG_WIDTH, maxSizeKB = MAX_IMG_KB) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        let quality = 0.82;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        let sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024);
        while (sizeKB > maxSizeKB && quality > 0.3) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024);
        }
        resolve({ dataUrl, sizeKB, type: 'image/jpeg', name: file.name.replace(/\.[^.]+$/, '.jpg') });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
};

export const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const dataUrl = reader.result;
      const sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024);
      resolve({ dataUrl, sizeKB, type: file.type, name: file.name });
    };
    reader.readAsDataURL(file);
  });
};

export const processProofFiles = async (files) => {
  const arr = Array.from(files);
  if (arr.length > MAX_IMAGES_PER_TXN) throw new Error(`Maximum ${MAX_IMAGES_PER_TXN} files allowed.`);
  const results = [];
  for (const file of arr) {
    let res;
    if (file.type.startsWith('image/')) res = await compressImage(file);
    else if (file.type === 'application/pdf') {
      res = await fileToBase64(file);
      if (res.sizeKB > MAX_PDF_KB) throw new Error(`PDF "${file.name}" is too large (${res.sizeKB} KB). Max ${MAX_PDF_KB} KB.`);
    } else throw new Error(`File "${file.name}" is not an image or PDF.`);
    results.push({ dataUrl: res.dataUrl, type: res.type, name: res.name, sizeKB: res.sizeKB });
  }
  return results;
};

export const downloadDataUrl = (dataUrl, filename) => {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename || 'proof';
  document.body.appendChild(a); a.click(); a.remove();
};
