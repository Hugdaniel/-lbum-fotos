// 1. ESPERAR A QUE CARGUE EL HTML
// Esta línea es fundamental. Le dice al navegador: "No ejecutes nada de esto 
// hasta que no hayas terminado de leer todo el index.html".
// Si no la pones, JS podría intentar buscar el título o la galería antes de que existan.
document.addEventListener('DOMContentLoaded', () => {

    // 2. REFERENCIAS A ELEMENTOS DEL HTML
    // Usamos 'document.getElementById' para "capturar" los lugares vacíos que 
    // dejamos en el HTML y guardarlos en variables para usarlos después.
    const titulo = document.getElementById('titulo-evento');
    const subtitulo = document.getElementById('subtitulo-evento');
    const galeria = document.getElementById('galeria');
    const appContainer = document.getElementById('app');

    // 3. INYECTAR DATOS BÁSICOS DESDE CONFIG.JS
    // Tomamos los textos que definiste en CONFIG y los ponemos como contenido.
    // .innerText cambia el texto visible.

    // comento la seccion del titulo
    // titulo.innerText = CONFIG.nombreEvento;
    // subtitulo.innerText = `¡Reviví los mejores momentos de ${CONFIG.nombreEvento}!`;

    // 4. PONER EL FONDO DE LA JUNGLA DINÁMICAMENTE
    // En lugar de poner el fondo solo con CSS, lo hacemos con JS para que 
    // puedas cambiarlo fácilmente desde config.js para cada cliente.
    appContainer.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.5)), url('${CONFIG.fondoImg}')`;

    // 5. EL BUCLE MÁGICO DE LAS FOTOS (Lo más importante)
    // 'CONFIG.fotos' es una lista (array). .forEach significa "para cada una".
    // Este bucle se ejecutará una vez por cada nombre de foto que hayas puesto en la lista.


    // ¡OJO! Todo lo que esté adentro de este bucle se repetirá por cada foto. Si tienes 10 fotos, se repetirá 10 veces, una por cada foto.
    // se comenta durante la fiesta, y se activa despues de procesar las fotos
    // CONFIG.fotos.forEach(nombreFoto => {
    //     // A. Crear el contenedor de la foto (el bloque de inventario)
    //     // Usamos document.createElement para fabricar una etiqueta <div> desde cero.
    //     const fotoItem = document.createElement('div');
    //     // Le asignamos la clase CSS para que tenga el borde y tamaño de bloque.
    //     fotoItem.classList.add('foto-item');

    //     // B. Crear la imagen real
    //     // Fabricamos una etiqueta <img>.
    //     const img = document.createElement('img');
    //     // Le decimos dónde está la foto. Buscamos en la carpeta 'fotos-evento/' 
    //     // y le sumamos el nombre del archivo (ej: 'foto1.jpg').
    //     img.src = `assets/${nombreFoto}`;
    //     // Ponemos un texto alternativo por accesibilidad.
    //     img.alt = `assets ${CONFIG.nombreEvento}`;
    //     // Agregamos 'loading="lazy"'. ¡Truco Pro! Esto hace que el celu no 
    //     // descargue la foto hasta que el usuario no scrollee cerca. Ahorra datos y batería.
    //     img.loading = "lazy";

    //     // C. Armar la estructura
    //     // Metemos la imagen <img> DENTRO del contenedor <div>.
    //     fotoItem.appendChild(img);

    //     // D. Inyectar en la página real
    //     // Finalmente, metemos todo ese bloque DENTRO de la sección 'galeria' del HTML.
    //     galeria.appendChild(fotoItem);
    // });

    // barra de carga
    window.addEventListener('load', () => {
    const loader = document.getElementById('loader-minecraft');
    
    // Le damos un pequeño delay extra para que se aprecie la animación
    setTimeout(() => {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.style.display = 'none';
        }, 1000); // Espera a que termine la transición de opacidad
    }, 3800); 
});

// corresponde a DOMContentLoaded
}); 