/*
  ╔════════════════════════════════════════════════════╗
  ║  app.js — Álbum de Fotos Cumple Minecraft          ║
  ║                                                    ║
  ║  Base de datos: Firebase Firestore (tiempo real)   ║
  ║  Fotos: guardadas como base64 en Firestore         ║
  ║  (sin Firebase Storage — no requiere upgrade)      ║
  ╚════════════════════════════════════════════════════╝
*/

/* ══════════════════════════════════════
   1. FIREBASE — solo Firestore, sin Storage
   La foto comprimida (base64) se guarda
   directamente como campo del documento.
   Límite Firestore por doc: 1MB.
   Comprimimos a menos de 750KB → entra bien.
══════════════════════════════════════ */
import { initializeApp }                       from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, addDoc,
         deleteDoc, doc, updateDoc, increment,
         onSnapshot, query, orderBy }          from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            "AIzaSyD-eFqalBS9kx_MBQqBIfJKOTODVzMEunI",
  authDomain:        "diego-minecraft.firebaseapp.com",
  projectId:         "diego-minecraft",
  storageBucket:     "diego-minecraft.firebasestorage.app",
  messagingSenderId: "474866264166",
  appId:             "1:474866264166:web:c8cd54b39d7aa441fe25a7",
  measurementId:     "G-SJC1EK5GYB"
};

const app       = initializeApp(firebaseConfig);
const db        = getFirestore(app);
const photosCol = collection(db, 'photos');


/* ══════════════════════════════════════
   2. CONFIGURACIÓN DE COMPRESIÓN
   MAX_MB bajo (0.75) para no superar el
   límite de 1MB por documento de Firestore.
══════════════════════════════════════ */
const MAX_W   = 900;
const MAX_H   = 900;
const QUALITY = 0.78;
const MAX_MB  = 0.75;


/* ══════════════════════════════════════
   3. ESTADO GLOBAL
══════════════════════════════════════ */
let compressed = null;
let allPhotos  = [];
let lightboxId = null;

let myLikes = new Set(
  JSON.parse(sessionStorage.getItem('mc_my_likes') || '[]')
);


/* ══════════════════════════════════════
   4. REFERENCIAS AL DOM
══════════════════════════════════════ */
const $ = id => document.getElementById(id);

const dropZone     = $('drop-zone');
const fileInput    = $('file-input');
const previewWrap  = $('preview-wrap');
const previewImg   = $('preview-img');
const fileInfo     = $('file-info');
const nameInput    = $('name-input');
const uploadBtn    = $('upload-btn');
const progWrap     = $('progress-wrap');
const progBar      = $('prog-bar');
const progLabel    = $('prog-label');
const grid         = $('photo-grid');
const photoCount   = $('photo-count');
const refreshBtn   = $('refresh-btn');
const downloadBtn  = $('download-btn');
const lightbox     = $('lightbox');
const lbImg        = $('lb-img');
const lbInfo       = $('lb-info');
const lbLikes      = $('lb-likes');
const lbClose      = $('lb-close');
const lbDeleteBtn  = $('lb-delete-btn');
const confirmModal = $('confirm-modal');
const confirmYes   = $('confirm-yes');
const confirmNo    = $('confirm-no');


/* ══════════════════════════════════════
   5. COMPRESIÓN DE IMÁGENES
   Todo en el navegador. El base64 resultante
   se guarda directo en Firestore.
══════════════════════════════════════ */
function compressImage(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        const ratio = Math.min(MAX_W / w, MAX_H / h, 1);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);

        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);

        let q = QUALITY;
        const tryQ = () => {
          const url   = canvas.toDataURL('image/jpeg', q);
          const bytes = Math.round((url.length - 22) * 3 / 4);
          if (bytes / 1024 / 1024 > MAX_MB && q > 0.25) {
            q -= 0.08;
            setTimeout(tryQ, 0);
          } else {
            res({ url, origSize: file.size, size: bytes, w, h });
          }
        };
        tryQ();
      };
      img.onerror = rej;
      img.src = e.target.result;
    };
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}


/* ══════════════════════════════════════
   6. SELECCIÓN DE ARCHIVO
══════════════════════════════════════ */
fileInput.addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f || !f.type.startsWith('image/')) return;
  await handleFile(f);
});

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', async e => {
  e.preventDefault(); dropZone.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) await handleFile(f);
});

async function handleFile(file) {
  showProg('🗜️ Comprimiendo imagen...', 35);
  try {
    const r    = await compressImage(file);
    compressed = r.url;
    const oKB  = Math.round(r.origSize / 1024);
    const fKB  = Math.round(r.size / 1024);
    const save = Math.round((1 - r.size / r.origSize) * 100);
    previewImg.src = compressed;
    previewWrap.style.display = 'block';
    fileInfo.innerHTML = `Original: ${oKB}KB → ${fKB}KB (${save}% menos) · ${r.w}×${r.h}px`;
    hideProg();
    updateBtn();
    toast('✅ Imagen lista!', 'ok');
  } catch {
    hideProg();
    toast('❌ Error al procesar la imagen', 'err');
  }
}

nameInput.addEventListener('input', updateBtn);
function updateBtn() {
  uploadBtn.disabled = !(compressed && nameInput.value.trim());
}


/* ══════════════════════════════════════
   7. SUBIDA AL ÁLBUM
   Sin Storage: el base64 va directo a Firestore.

   Documento guardado en Firestore:
   {
     name:      "Steve ⚔️",
     dataUrl:   "data:image/jpeg;base64,...",
     likes:     0,
     createdAt: Timestamp
   }
══════════════════════════════════════ */
uploadBtn.addEventListener('click', async () => {
  if (!compressed || !nameInput.value.trim()) return;

  uploadBtn.disabled = true;
  showProg('☁️ Guardando en Firestore...', 60);

  try {
    await addDoc(photosCol, {
      name:      nameInput.value.trim(),
      dataUrl:   compressed,
      likes:     0,
      createdAt: new Date()
    });

    hideProg();
    toast('🎉 ¡Foto subida! Aparecés en el álbum de todos 🧱', 'ok');

    compressed = null;
    fileInput.value = '';
    previewWrap.style.display = 'none';
    nameInput.value = '';
    updateBtn();

  } catch (err) {
    hideProg();
    uploadBtn.disabled = false;
    console.error('Error subiendo foto:', err);
    toast('❌ Error al guardar. Revisá la conexión.', 'err');
  }
});


/* ══════════════════════════════════════
   8. TIEMPO REAL — onSnapshot
   Cada cambio en Firestore actualiza
   todos los dispositivos automáticamente.
══════════════════════════════════════ */
function initRealtime() {
  const q = query(photosCol, orderBy('createdAt', 'desc'));

  onSnapshot(q, snapshot => {
    allPhotos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGrid();

    if (lightboxId) {
      const foto = allPhotos.find(p => p.id === lightboxId);
      if (foto) lbLikes.textContent = `❤️ ${foto.likes || 0} like${foto.likes !== 1 ? 's' : ''}`;
    }
  }, err => {
    console.error('Error Firestore:', err);
    toast('❌ Error de conexión con Firebase', 'err');
  });
}


/* ══════════════════════════════════════
   9. RENDERIZADO DE LA GRILLA
   src de <img> usa el dataUrl directamente.
══════════════════════════════════════ */
function renderGrid() {
  if (allPhotos.length === 0) {
    grid.innerHTML = '<div id="loading-state" style="color:#555">🏠 No hay fotos todavía...<br>¡Sé el primero en subir!</div>';
    photoCount.textContent = '';
    downloadBtn.disabled = true;
    return;
  }

  photoCount.textContent = `💎 ${allPhotos.length} foto${allPhotos.length !== 1 ? 's' : ''} en el álbum`;
  downloadBtn.disabled = false;

  grid.innerHTML = allPhotos.map(p => {
    const lc    = p.likes || 0;
    const liked = myLikes.has(p.id);
    return `
    <div class="card" data-id="${p.id}">
      <button class="card-delete" onclick="askDelete(event,'${p.id}')" title="Eliminar">🗑</button>
      <img class="card-thumb" src="${p.dataUrl}" alt="${esc(p.name)}" loading="lazy" onclick="openLb('${p.id}')">
      <div class="card-footer">
        <div class="card-name">🧱 ${esc(p.name)}</div>
        <div class="card-meta">
          <span class="card-date">${formatDate(p.createdAt)}</span>
          <button class="like-btn ${liked ? 'liked' : ''}" onclick="toggleLike(event,'${p.id}')">
            <span class="heart">${liked ? '❤️' : '🤍'}</span>
            <span class="like-count">${lc}</span>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function formatDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}


/* ══════════════════════════════════════
   10. LIKES
══════════════════════════════════════ */
async function toggleLike(e, id) {
  e.stopPropagation();
  const liked = myLikes.has(id);
  if (liked) { myLikes.delete(id); } else { myLikes.add(id); }
  sessionStorage.setItem('mc_my_likes', JSON.stringify([...myLikes]));
  try {
    await updateDoc(doc(db, 'photos', id), { likes: increment(liked ? -1 : 1) });
  } catch (err) { console.error('Error en like:', err); }
}
window.toggleLike = toggleLike;


/* ══════════════════════════════════════
   11. LIGHTBOX
══════════════════════════════════════ */
function openLb(id) {
  const p = allPhotos.find(x => x.id === id);
  if (!p) return;
  lightboxId          = id;
  lbImg.src           = p.dataUrl;
  lbInfo.textContent  = `🧱 ${p.name}`;
  lbLikes.textContent = `❤️ ${p.likes || 0} like${(p.likes || 0) !== 1 ? 's' : ''}`;
  lightbox.classList.add('open');
}
window.openLb = openLb;

lbClose.addEventListener('click', closeLb);
lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLb(); });

function closeLb() {
  lightbox.classList.remove('open');
  lightboxId = null;
}


/* ══════════════════════════════════════
   12. ELIMINAR FOTO
   Solo borra el documento de Firestore.
   Sin Storage, no hay archivo extra que borrar.
══════════════════════════════════════ */
let pendingDeleteId = null;

function askDelete(e, id) {
  e.stopPropagation();
  pendingDeleteId = id;
  confirmModal.classList.add('open');
}
window.askDelete = askDelete;

lbDeleteBtn.addEventListener('click', () => {
  if (!lightboxId) return;
  pendingDeleteId = lightboxId;
  confirmModal.classList.add('open');
});

confirmYes.addEventListener('click', async () => {
  confirmModal.classList.remove('open');
  if (!pendingDeleteId) return;
  try {
    showProg('🗑 Eliminando foto...', 60);
    await deleteDoc(doc(db, 'photos', pendingDeleteId));
    if (lightboxId === pendingDeleteId) closeLb();
    hideProg();
    toast('🗑 Foto eliminada del álbum', 'ok');
  } catch (err) {
    hideProg();
    console.error('Error al eliminar:', err);
    toast('❌ Error al eliminar la foto', 'err');
  }
  pendingDeleteId = null;
});

confirmNo.addEventListener('click', () => {
  confirmModal.classList.remove('open');
  pendingDeleteId = null;
});


/* ══════════════════════════════════════
   13. DESCARGAR TODAS LAS FOTOS
   Base64 → descarga directa, funciona
   perfecto en móvil también.
══════════════════════════════════════ */
downloadBtn.addEventListener('click', async () => {
  if (!allPhotos.length) return;
  downloadBtn.disabled = true;
  toast('⬇ Descargando fotos...', 'ok');

  for (let i = 0; i < allPhotos.length; i++) {
    const p = allPhotos[i];
    await new Promise(r => setTimeout(r, 350));
    const a = document.createElement('a');
    a.href = p.dataUrl;
    const safeName = p.name.replace(/[^a-z0-9áéíóúüñ\s]/gi,'').trim().replace(/\s+/g,'_');
    a.download = `cumple_minecraft_${i + 1}_${safeName}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  downloadBtn.disabled = false;
  toast(`✅ ${allPhotos.length} fotos descargadas!`, 'ok');
});


/* ══════════════════════════════════════
   Refresh manual
══════════════════════════════════════ */
refreshBtn.addEventListener('click', () => {
  toast('🔄 El álbum se actualiza automáticamente', 'ok');
});


/* ══════════════════════════════════════
   14. HELPERS
══════════════════════════════════════ */
function showProg(lbl, pct) {
  progWrap.style.display = 'block';
  progLabel.textContent  = lbl;
  progBar.style.width    = pct + '%';
}
function hideProg() {
  progWrap.style.display = 'none';
  progBar.style.width    = '0%';
}

let toastT;
function toast(msg, type = '') {
  clearTimeout(toastT);
  const el = $('toast');
  el.textContent = msg;
  el.className   = 'show ' + (type || '');
  toastT = setTimeout(() => el.className = '', 3500);
}

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}


/* ══════════════════════════════════════
   INICIO
══════════════════════════════════════ */
grid.innerHTML = '<div id="loading-state"><span class="spinner"></span> Conectando con Firebase...</div>';
initRealtime();