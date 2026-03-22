/* ════════════════════════════════════════════════
   STORAGE  – usa window.storage (artifact storage)
   con fallback a localStorage si no está disponible
════════════════════════════════════════════════ */
const Storage = {
  async get(key){
    try{
      const r = await window.storage.get(key, true); // shared=true
      return r ? JSON.parse(r.value) : null;
    }catch{
      try{ const v=localStorage.getItem(key); return v?JSON.parse(v):null; }catch{ return null; }
    }
  },
  async set(key,val){
    try{
      await window.storage.set(key, JSON.stringify(val), true);
    }catch{
      try{ localStorage.setItem(key,JSON.stringify(val)); }catch{}
    }
  }
};

/* ════════ CONFIG ════════ */
const PHOTOS_KEY   = 'mc_album_photos_v2';
const LIKES_KEY    = 'mc_album_likes_v2';
const MAX_W = 800, MAX_H = 800, QUALITY = 0.75, MAX_MB = 0.8;

/* ════════ STATE ════════ */
let compressed  = null;   // dataUrl
let allPhotos   = [];
let allLikes    = {};     // { id: count }
let myLikes     = new Set( JSON.parse(sessionStorage.getItem('mc_my_likes')||'[]') );
let lightboxId  = null;

/* ════════ ELEMENTS ════════ */
const $=id=>document.getElementById(id);
const dropZone   = $('drop-zone');
const fileInput  = $('file-input');
const previewWrap= $('preview-wrap');
const previewImg = $('preview-img');
const fileInfo   = $('file-info');
const nameInput  = $('name-input');
const uploadBtn  = $('upload-btn');
const progWrap   = $('progress-wrap');
const progBar    = $('prog-bar');
const progLabel  = $('prog-label');
const grid       = $('photo-grid');
const photoCount = $('photo-count');
const refreshBtn = $('refresh-btn');
const downloadBtn= $('download-btn');
const lightbox   = $('lightbox');
const lbImg      = $('lb-img');
const lbInfo     = $('lb-info');
const lbLikes    = $('lb-likes');
const lbClose    = $('lb-close');

/* ════════ COMPRESS ════════ */
function compressImage(file){
  return new Promise((res,rej)=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        let w=img.width,h=img.height;
        const ratio=Math.min(MAX_W/w,MAX_H/h,1);
        w=Math.round(w*ratio); h=Math.round(h*ratio);
        const canvas=document.createElement('canvas');
        canvas.width=w; canvas.height=h;
        const ctx=canvas.getContext('2d');
        ctx.imageSmoothingQuality='high';
        ctx.drawImage(img,0,0,w,h);
        let q=QUALITY;
        const tryQ=()=>{
          const url=canvas.toDataURL('image/jpeg',q);
          const bytes=Math.round((url.length-22)*3/4);
          if(bytes/1024/1024>MAX_MB && q>0.3){ q-=0.08; setTimeout(tryQ,0); }
          else res({url,origSize:file.size,size:bytes,w,h});
        };
        tryQ();
      };
      img.onerror=rej;
      img.src=e.target.result;
    };
    reader.onerror=rej;
    reader.readAsDataURL(file);
  });
}

/* ════════ FILE SELECT ════════ */
fileInput.addEventListener('change',async e=>{
  const f=e.target.files[0];
  if(!f||!f.type.startsWith('image/')) return;
  await handleFile(f);
});
dropZone.addEventListener('dragover',e=>{e.preventDefault();dropZone.classList.add('over');});
dropZone.addEventListener('dragleave',()=>dropZone.classList.remove('over'));
dropZone.addEventListener('drop',async e=>{
  e.preventDefault(); dropZone.classList.remove('over');
  const f=e.dataTransfer.files[0];
  if(f) await handleFile(f);
});

async function handleFile(file){
  showProg('🗜️ Comprimiendo imagen...',35);
  try{
    const r=await compressImage(file);
    compressed=r.url;
    const oKB=Math.round(r.origSize/1024);
    const fKB=Math.round(r.size/1024);
    const save=Math.round((1-r.size/r.origSize)*100);
    previewImg.src=compressed;
    previewWrap.style.display='block';
    fileInfo.innerHTML=`Original: ${oKB}KB → ${fKB}KB (${save}% menos) · ${r.w}×${r.h}px`;
    hideProg();
    updateBtn();
    toast('✅ Imagen lista!','ok');
  }catch{
    hideProg();
    toast('❌ Error al procesar la imagen','err');
  }
}

nameInput.addEventListener('input',updateBtn);
function updateBtn(){ uploadBtn.disabled=!(compressed && nameInput.value.trim()); }

/* ════════ UPLOAD ════════ */
uploadBtn.addEventListener('click',async()=>{
  if(!compressed||!nameInput.value.trim()) return;
  uploadBtn.disabled=true;
  showProg('☁️ Guardando en el álbum compartido...',70);

  try{
    const photos = (await Storage.get(PHOTOS_KEY)) || [];
    const newPhoto={
      id: Date.now()+'_'+Math.random().toString(36).slice(2,7),
      name: nameInput.value.trim(),
      url: compressed,
      ts: new Date().toLocaleString('es-AR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
    };
    photos.push(newPhoto);
    await Storage.set(PHOTOS_KEY, photos);

    // init likes if needed
    const likes = (await Storage.get(LIKES_KEY)) || {};
    likes[newPhoto.id]=0;
    await Storage.set(LIKES_KEY, likes);

    hideProg();
    toast('🎉 ¡Foto subida! Aparecés en el álbum de todos 🧱','ok');
    // reset
    compressed=null; fileInput.value='';
    previewWrap.style.display='none';
    nameInput.value=''; updateBtn();
    await loadAlbum();
  }catch(err){
    hideProg();
    uploadBtn.disabled=false;
    toast('❌ Error al guardar. Intentá de nuevo.','err');
  }
});

/* ════════ LOAD ALBUM ════════ */
async function loadAlbum(){
  grid.innerHTML='<div id="loading-state"><span class="spinner"></span> Cargando fotos...</div>';
  downloadBtn.disabled=true;

  const [photos,likes]=await Promise.all([
    Storage.get(PHOTOS_KEY),
    Storage.get(LIKES_KEY)
  ]);
  allPhotos = photos || [];
  allLikes  = likes  || {};

  renderGrid();
}

function renderGrid(){
  if(allPhotos.length===0){
    grid.innerHTML='<div id="loading-state" style="color:#555">🏠 No hay fotos todavía...<br>¡Sé el primero en subir!</div>';
    photoCount.textContent='';
    downloadBtn.disabled=true;
    return;
  }

  photoCount.textContent=`💎 ${allPhotos.length} foto${allPhotos.length!==1?'s':''} en el álbum`;
  downloadBtn.disabled=false;

  const sorted=[...allPhotos].reverse();
  grid.innerHTML=sorted.map(p=>{
    const lc=allLikes[p.id]||0;
    const liked=myLikes.has(p.id);
    return `
    <div class="card" data-id="${p.id}">
      <img class="card-thumb" src="${p.url}" alt="${esc(p.name)}" loading="lazy"
           onclick="openLb('${p.id}')">
      <div class="card-footer">
        <div class="card-name">🧱 ${esc(p.name)}</div>
        <div class="card-meta">
          <span class="card-date">${p.ts}</span>
          <button class="like-btn ${liked?'liked':''}" onclick="toggleLike(event,'${p.id}')">
            <span class="heart">${liked?'❤️':'🤍'}</span>
            <span class="like-count">${lc}</span>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ════════ LIKES ════════ */
async function toggleLike(e,id){
  e.stopPropagation();
  const liked=myLikes.has(id);

  // optimistic UI
  if(liked){ myLikes.delete(id); allLikes[id]=Math.max(0,(allLikes[id]||1)-1); }
  else      { myLikes.add(id);   allLikes[id]=(allLikes[id]||0)+1; }
  sessionStorage.setItem('mc_my_likes',JSON.stringify([...myLikes]));
  renderGrid();

  // persist
  try{
    const likes=(await Storage.get(LIKES_KEY))||{};
    likes[id]=allLikes[id];
    await Storage.set(LIKES_KEY,likes);
  }catch{}

  // update lightbox if open
  if(lightboxId===id) lbLikes.textContent=`❤️ ${allLikes[id]||0} like${(allLikes[id]||0)!==1?'s':''}`;
}

/* ════════ LIGHTBOX ════════ */
function openLb(id){
  const p=allPhotos.find(x=>x.id===id);
  if(!p) return;
  lightboxId=id;
  lbImg.src=p.url;
  lbInfo.textContent=`🧱 ${p.name}  ·  ${p.ts}`;
  lbLikes.textContent=`❤️ ${allLikes[id]||0} like${(allLikes[id]||0)!==1?'s':''}`;
  lightbox.classList.add('open');
}
window.openLb=openLb;
window.toggleLike=toggleLike;
lbClose.addEventListener('click',()=>{lightbox.classList.remove('open');lightboxId=null;});
lightbox.addEventListener('click',e=>{if(e.target===lightbox){lightbox.classList.remove('open');lightboxId=null;}});

/* ════════ REFRESH ════════ */
refreshBtn.addEventListener('click',async()=>{
  refreshBtn.disabled=true;
  await loadAlbum();
  refreshBtn.disabled=false;
  toast('🔄 Álbum actualizado!','ok');
});

/* ════════ DOWNLOAD ALL ════════ */
downloadBtn.addEventListener('click',async()=>{
  if(!allPhotos.length) return;
  downloadBtn.disabled=true;
  toast('⬇ Descargando fotos...','ok');

  // Download one by one with small delay to avoid browser blocking
  for(let i=0;i<allPhotos.length;i++){
    const p=allPhotos[i];
    await new Promise(r=>setTimeout(r,300));
    const a=document.createElement('a');
    a.href=p.url;
    const safeName=p.name.replace(/[^a-z0-9áéíóúüñ\s]/gi,'').trim().replace(/\s+/g,'_');
    a.download=`cumple_minecraft_${i+1}_${safeName}.jpg`;
    a.click();
  }
  downloadBtn.disabled=false;
  toast(`✅ ${allPhotos.length} fotos descargadas!`,'ok');
});

/* ════════ HELPERS ════════ */
function showProg(lbl,pct){ progWrap.style.display='block'; progLabel.textContent=lbl; progBar.style.width=pct+'%'; }
function hideProg(){ progWrap.style.display='none'; progBar.style.width='0%'; }

let toastT;
function toast(msg,type=''){
  clearTimeout(toastT);
  const el=$('toast');
  el.textContent=msg; el.className='show '+(type||'');
  toastT=setTimeout(()=>el.className='',3200);
}

function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ════════ AUTO-REFRESH cada 30s ════════ */
setInterval(async()=>{
  const photos=await Storage.get(PHOTOS_KEY)||[];
  const likes =await Storage.get(LIKES_KEY )||{};
  if(photos.length!==allPhotos.length){
    allPhotos=photos; allLikes=likes;
    renderGrid();
    toast('📸 ¡Nuevas fotos en el álbum!','ok');
  } else {
    // update likes silently
    allLikes=likes;
    document.querySelectorAll('.card').forEach(card=>{
      const id=card.dataset.id;
      const btn=card.querySelector('.like-count');
      if(btn) btn.textContent=allLikes[id]||0;
    });
  }
},30000);

/* ════════ INIT ════════ */
loadAlbum();