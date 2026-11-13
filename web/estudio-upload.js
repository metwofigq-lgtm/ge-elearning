const uploadMessages={
 en:['Select a file up to 100 MB.','Could not save the file. '],
 fr:['Sélectionnez un fichier de 100 Mo maximum.','Impossible d’enregistrer le fichier. '],
 es:['Selecciona un archivo de hasta 100 MB.','No se pudo guardar el archivo. ']
};
const messages=uploadMessages[document.documentElement.lang]||uploadMessages.es;
for (const form of document.querySelectorAll('form[data-upload]')) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const file = form.elements.archivo.files[0];
    const status = form.querySelector('output');
    const button = form.querySelector('button');
    if (!file || !file.size || file.size > 100 * 1024 * 1024) {
      status.textContent = messages[0];
      return;
    }
    button.disabled = true;
    try {
      const init = await fetch(form.action, {method:'POST', body:new URLSearchParams({
        revision:form.elements.revision.value, size:String(file.size), name:file.name
      })});
      if (!init.ok) throw new Error(await init.text());
      const {url} = await init.json();
      const chunk = 512 * 1024;
      for (let offset = 0; offset < file.size; offset += chunk) {
        const result = await fetch(url + '/' + offset, {method:'POST', body:file.slice(offset, offset + chunk)});
        if (!result.ok) throw new Error(await result.text());
        status.textContent = Math.min(100, Math.round(100 * (offset + chunk) / file.size)) + ' %';
      }
      location.reload();
    } catch (error) {
      status.textContent = messages[1] + error.message.slice(0,160);
      button.disabled = false;
    }
  });
}
