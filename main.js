/*
  ╔════════════════════════════════════════════════════╗
  ║  app.js — Álbum de Fotos Cumple Minecraft          ║
  ║                                                    ║
  ║  Base de datos: Firebase Firestore (tiempo real)   ║
  ║  Archivos:      Firebase Storage (fotos)           ║
  ║                                                    ║
  ║  Secciones:                                        ║
  ║   1. Firebase — inicialización y configuración     ║
  ║   2. Configuración de compresión                   ║
  ║   3. Estado global                                 ║
  ║   4. Referencias al DOM                            ║
  ║   5. Compresión de imágenes (canvas)               ║
  ║   6. Selección de archivo                          ║
  ║   7. Subida: comprime → Storage → Firestore        ║
  ║   8. Escucha en tiempo real (onSnapshot)           ║
  ║   9. Renderizado de la grilla                      ║
  ║  10. Likes                                         ║
  ║  11. Lightbox                                      ║
  ║  12. Eliminar foto                                 ║
  ║  13. Descargar todas las fotos                     ║
  ║  14. Helpers                                       ║
  ╚════════════════════════════════════════════════════╝
*/

/* ══════════════════════════════════════
   1. FIREBASE — inicialización
   Importamos solo los módulos que usamos
   (tree-shakeable SDK) desde el CDN oficial.
   No necesitás instalar nada ni usar npm.

   Firestore → base de datos en tiempo real
               guarda metadata: nombre, url, fecha, likes
   Storage   → almacena los archivos de imagen (jpeg)
══════════════════════════════════════ */
import { initializeApp }                          from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, addDoc,
         deleteDoc, doc, updateDoc, increment,
         onSnapshot, query, orderBy }             from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage, ref, uploadString,
         getDownloadURL, deleteObject }           from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// Tu configuración de Firebase
// ⚠️ No compartas este archivo públicamente en GitHub sin restricciones de dominio
const firebaseConfig = {
  apiKey:            "AIzaSyD-eFqalBS9kx_MBQqBIfJKOTODVzMEunI",
  authDomain:        "diego-minecraft.firebaseapp.com",
  projectId:         "diego-minecraft",
  storageBucket:     "diego-minecraft.firebasestorage.app",
  messagingSenderId: "474866264166",
  appId:             "1:474866264166:web:c8cd54b39d7aa441fe25a7",
  measurementId:     "G-SJC1EK5GYB"
};

// Inicializar Firebase y obtener los servicios
const app       = initializeApp(firebaseConfig);
const db        = getFirestore(app);   // base de datos
const storage   = getStorage(app);     // almacenamiento de archivos

// Referencia a la colección de fotos en Firestore
// Cada documento = una foto con sus datos
const photosCol = collection(db, 'photos');


/* ══════════════════════════════════════
   2. CONFIGURACIÓN DE COMPRESIÓN
   Ajustá estos valores si querés cambiar
   la calidad o el tamaño de las fotos.
══════════════════════════════════════ */
const MAX_W    = 1024;   // ancho máximo en píxeles
const MAX_H    = 1024;   // alto máximo en píxeles
const QUALITY  = 0.80;   // calidad JPEG inicial (0 a 1)
const MAX_MB   = 1.5;    // peso máximo por foto en MB


/* ══════════════════════════════════════
   3. ESTADO GLOBAL
══════════════════════════════════════ */
let compressed  = null;   // dataUrl de la foto comprimida (base64)
let allPhotos   = [];     // array con todas las fotos cargadas
let lightboxId  = null;   // id del doc Firestore abierto en lightbox
let lightboxStoragePath = null; // path en Storage de la foto abierta

// Likes dados por este usuario en esta sesión (evita doble like)
let myLikes = new Set(
  JSON.parse(sessionStorage.getItem('mc_my_likes') || '[]')
);


/* ══════════════════════════════════════
   4. REFERENCIAS AL DOM
══════════════════════════════════════ */
const $ = id => document.getElementById(id);

const dropZone      = $('drop-zone');
const fileInput     = $('file-input');
const previewWrap   = $('preview-wrap');
const previewImg    = $('preview-img');
const fileInfo      = $('file-info');
const nameInput     = $('name-input');
const uploadBtn     = $('upload-btn');
const progWrap      = $('progress-wrap');
const progBar       = $('prog-bar');
const progLabel     = $('prog-label');
const grid          = $('photo-grid');
const photoCount    = $('photo-count');
const refreshBtn    = $('refresh-btn');
const downloadBtn   = $('download-btn');
const lightbox      = $('lightbox');
const lbImg         = $('lb-img');
const lbInfo        = $('lb-info');
const lbLikes       = $('lb-likes');
const lbClose       = $('lb-close');
const lbDeleteBtn   = $('lb-delete-btn');
const confirmModal  = $('confirm-modal');
const confirmYes    = $('confirm-yes');
const confirmNo     = $('confirm-no');


/* ══════════════════════════════════════
   5. COMPRESIÓN DE IMÁGENES
   Todo en el navegador, sin servidor.

   Proceso:
   1. FileReader lee el archivo → dataUrl
   2. Se dibuja en un <canvas> redimensionado
   3. Se exporta como JPEG con calidad q
   4. Si supera MAX_MB, baja q y reintenta
   5. Devuelve la dataUrl final (base64)

   Usamos 'data_url' format en uploadString
   de Firebase Storage para subir el base64.
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
          if (bytes / 1024 / 1024 > MAX_MB && q > 0.3) {
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

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('over');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));

dropZone.addEventListener('drop', async e => {
  e.preventDefault();
  dropZone.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) await handleFile(f);
});

async function handleFile(file) {
  showProg('🗜️ Comprimiendo imagen...', 35);
  try {
    const r   = await compressImage(file);
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
   Pasos:
   1. Comprime la imagen (ya hecho en handleFile)
   2. Sube el base64 a Firebase Storage
      → devuelve una URL pública permanente
   3. Guarda en Firestore el documento con:
      - name: apodo del invitado
      - url:  URL pública de la foto en Storage
      - storagePath: path para poder borrarla después
      - likes: 0
      - createdAt: timestamp del servidor

   La URL de Storage es la que se muestra en el álbum.
   El base64 NO se guarda en Firestore (sería muy grande).
══════════════════════════════════════ */
uploadBtn.addEventListener('click', async () => {
  if (!compressed || !nameInput.value.trim()) return;

  uploadBtn.disabled = true;
  showProg('☁️ Subiendo foto a Firebase...', 50);

  try {
    // Paso 1: subir imagen a Firebase Storage
    // El path incluye timestamp para que sea único
    const storagePath = `photos/${Date.now()}_${Math.random().toString(36).slice(2,7)}.jpg`;
    const storageRef  = ref(storage, storagePath);

    // uploadString con 'data_url' acepta directamente el base64 del canvas
    await uploadString(storageRef, compressed, 'data_url');

    showProg('📝 Guardando en el álbum...', 80);

    // Paso 2: obtener URL pública permanente
    const url = await getDownloadURL(storageRef);

    // Paso 3: guardar metadata en Firestore
    await addDoc(photosCol, {
      name:        nameInput.value.trim(),
      url:         url,           // URL pública para mostrar la imagen
      storagePath: storagePath,   // path en Storage para poder eliminarla
      likes:       0,
      createdAt:   new Date()     // fecha para ordenar
    });

    hideProg();
    toast('🎉 ¡Foto subida! Aparecés en el álbum de todos 🧱', 'ok');

    // Limpiar formulario
    compressed = null;
    fileInput.value = '';
    previewWrap.style.display = 'none';
    nameInput.value = '';
    updateBtn();

  } catch (err) {
    hideProg();
    uploadBtn.disabled = false;
    console.error('Error subiendo foto:', err);
    toast('❌ Error al subir. Revisá la conexión.', 'err');
  }
});


/* ══════════════════════════════════════
   8. ESCUCHA EN TIEMPO REAL (onSnapshot)
   onSnapshot de Firestore mantiene una
   conexión abierta con la base de datos.
   Cada vez que alguien sube, elimina o
   da like a una foto, todos los dispositivos
   conectados reciben la actualización
   automáticamente sin recargar la página.

   Ordenamos por createdAt descendente
   para ver las fotos más nuevas primero.
══════════════════════════════════════ */
function initRealtime() {
  const q = query(photosCol, orderBy('createdAt', 'desc'));

  // onSnapshot devuelve una función para cancelar la suscripción
  // (no la usamos acá porque queremos escuchar siempre)
  onSnapshot(q, snapshot => {
    allPhotos = snapshot.docs.map(doc => ({
      id:          doc.id,           // id del documento en Firestore
      ...doc.data()                  // name, url, storagePath, likes, createdAt
    }));

    renderGrid();

    // Si el lightbox está abierto, actualizar los likes en tiempo real
    if (lightboxId) {
      const foto = allPhotos.find(p => p.id === lightboxId);
      if (foto) {
        lbLikes.textContent = `❤️ ${foto.likes || 0} like${foto.likes !== 1 ? 's' : ''}`;
      }
    }
  }, err => {
    console.error('Error en onSnapshot:', err);
    toast('❌ Error de conexión con la base de datos', 'err');
  });
}


/* ══════════════════════════════════════
   9. RENDERIZADO DE LA GRILLA
   Convierte el array allPhotos en tarjetas HTML.
   No necesitamos ordenar acá porque Firestore
   ya nos devuelve las fotos ordenadas.
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

      <!-- Botón eliminar (visible al hacer hover) -->
      <button class="card-delete"
              onclick="askDelete(event,'${p.id}','${esc(p.storagePath || '')}')"
              title="Eliminar foto">🗑</button>

      <img class="card-thumb"
           src="${p.url}"
           alt="${esc(p.name)}"
           loading="lazy"
           onclick="openLb('${p.id}')">

      <div class="card-footer">
        <div class="card-name">🧱 ${esc(p.name)}</div>
        <div class="card-meta">
          <span class="card-date">${formatDate(p.createdAt)}</span>
          <button class="like-btn ${liked ? 'liked' : ''}"
                  onclick="toggleLike(event,'${p.id}')">
            <span class="heart">${liked ? '❤️' : '🤍'}</span>
            <span class="like-count">${lc}</span>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// Formatea el timestamp de Firestore a fecha legible
function formatDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}


/* ══════════════════════════════════════
   10. LIKES
   Usamos increment(1) de Firestore para
   sumar/restar atómicamente.
   Esto es seguro: si dos personas dan like
   al mismo tiempo, Firestore los suma bien
   sin perder ninguno (a diferencia de leer,
   sumar y escribir manualmente).
══════════════════════════════════════ */
async function toggleLike(e, id) {
  e.stopPropagation();

  const liked = myLikes.has(id);

  // Actualizar sesión local
  if (liked) {
    myLikes.delete(id);
  } else {
    myLikes.add(id);
  }
  sessionStorage.setItem('mc_my_likes', JSON.stringify([...myLikes]));

  // Actualizar en Firestore con increment atómico
  try {
    const docRef = doc(db, 'photos', id);
    await updateDoc(docRef, {
      likes: increment(liked ? -1 : 1)
    });
    // onSnapshot actualizará la UI automáticamente
  } catch (err) {
    console.error('Error en like:', err);
  }
}

window.toggleLike = toggleLike;


/* ══════════════════════════════════════
   11. LIGHTBOX
══════════════════════════════════════ */
function openLb(id) {
  const p = allPhotos.find(x => x.id === id);
  if (!p) return;

  lightboxId          = id;
  lightboxStoragePath = p.storagePath || null;

  lbImg.src           = p.url;
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
  lightboxStoragePath = null;
}


/* ══════════════════════════════════════
   12. ELIMINAR FOTO
   Pasos:
   1. askDelete() → guarda el id y path, abre modal de confirmación
   2. Si el usuario confirma → deletePhoto()
   3. deletePhoto() elimina:
      a. El archivo de Firebase Storage (la imagen)
      b. El documento de Firestore (la metadata)
   4. onSnapshot detecta el cambio y actualiza la grilla automáticamente

   Guardamos id y path en variables temporales
   porque el modal de confirmación es asíncrono.
══════════════════════════════════════ */
let pendingDeleteId   = null;
let pendingDeletePath = null;

function askDelete(e, id, storagePath) {
  e.stopPropagation(); // evita abrir el lightbox

  pendingDeleteId   = id;
  pendingDeletePath = storagePath;

  confirmModal.classList.add('open');
}

window.askDelete = askDelete;

// También desde el lightbox
lbDeleteBtn.addEventListener('click', () => {
  if (!lightboxId) return;
  pendingDeleteId   = lightboxId;
  pendingDeletePath = lightboxStoragePath;
  confirmModal.classList.add('open');
});

// Confirmar eliminación
confirmYes.addEventListener('click', async () => {
  confirmModal.classList.remove('open');
  await deletePhoto(pendingDeleteId, pendingDeletePath);
  pendingDeleteId   = null;
  pendingDeletePath = null;
});

// Cancelar
confirmNo.addEventListener('click', () => {
  confirmModal.classList.remove('open');
  pendingDeleteId   = null;
  pendingDeletePath = null;
});

async function deletePhoto(id, storagePath) {
  try {
    showProg('🗑 Eliminando foto...', 60);

    // 1. Eliminar imagen de Firebase Storage
    if (storagePath) {
      const storageRef = ref(storage, storagePath);
      await deleteObject(storageRef);
    }

    // 2. Eliminar documento de Firestore
    await deleteDoc(doc(db, 'photos', id));

    // Si el lightbox tenía esa foto abierta, cerrarlo
    if (lightboxId === id) closeLb();

    hideProg();
    toast('🗑 Foto eliminada del álbum', 'ok');

    // onSnapshot actualizará la grilla automáticamente

  } catch (err) {
    hideProg();
    console.error('Error al eliminar:', err);
    toast('❌ Error al eliminar la foto', 'err');
  }
}


/* ══════════════════════════════════════
   13. DESCARGAR TODAS LAS FOTOS
   Crea un <a> con download para cada foto.
   El delay evita que el navegador bloquee
   múltiples descargas seguidas.
   
   Nota: en móvil algunos navegadores no
   soportan descarga directa de URLs externas.
   En ese caso se abre en una pestaña nueva.
══════════════════════════════════════ */
downloadBtn.addEventListener('click', async () => {
  if (!allPhotos.length) return;

  downloadBtn.disabled = true;
  toast('⬇ Descargando fotos...', 'ok');

  for (let i = 0; i < allPhotos.length; i++) {
    const p = allPhotos[i];
    await new Promise(r => setTimeout(r, 400));

    const a = document.createElement('a');
    a.href   = p.url;
    a.target = '_blank'; // fallback para móvil

    const safeName = p.name
      .replace(/[^a-z0-9áéíóúüñ\s]/gi, '')
      .trim()
      .replace(/\s+/g, '_');

    a.download = `cumple_minecraft_${i + 1}_${safeName}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  downloadBtn.disabled = false;
  toast(`✅ ${allPhotos.length} fotos descargadas!`, 'ok');
});


/* ══════════════════════════════════════
   Refresh manual (onSnapshot ya actualiza
   automáticamente, pero dejamos el botón
   por si acaso hay problemas de conexión)
══════════════════════════════════════ */
refreshBtn.addEventListener('click', () => {
  toast('🔄 El álbum se actualiza automáticamente en tiempo real', 'ok');
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

// Escapa caracteres HTML para evitar XSS
function esc(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}


/* ══════════════════════════════════════
   INICIO
   Arranca la escucha en tiempo real.
   A partir de acá, cualquier cambio en
   Firestore actualiza la grilla automáticamente.
══════════════════════════════════════ */
grid.innerHTML = '<div id="loading-state"><span class="spinner"></span> Conectando con Firebase...</div>';
initRealtime();