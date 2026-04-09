# Lector XML de noticias

## Que hace

La pagina:

- lee el archivo local `feeds.xml`
- obtiene la URL RSS XML del portal elegido
- descarga ese XML mediante un proxy publico para evitar CORS
- muestra las noticias en tarjetas

## Como abrirla

Conviene servir la carpeta con un servidor local para que `fetch()` pueda leer `feeds.xml`.

Ejemplo con PowerShell:

```powershell
python -m http.server 8000
```

Despues abre:

```text
http://localhost:8000
```

## Donde cambiar los portales

Edita `feeds.xml` y agrega mas nodos `<feed>` con este formato:

```xml
<feed name="Nombre visible" source="Medio">
  <url>https://direccion-del-rss.xml</url>
</feed>
```
