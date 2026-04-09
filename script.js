const selector = document.querySelector("#feedSelector");
const reloadButton = document.querySelector("#reloadButton");
const statusNode = document.querySelector("#status");
const newsGrid = document.querySelector("#newsGrid");
const template = document.querySelector("#newsCardTemplate");

const CONFIG_XML_PATH = "feeds.xml";
const MAX_NEWS = 9;
const MAX_DESCRIPTION_WORDS = 28;
const REQUEST_TIMEOUT_MS = 8000;
const FEED_PROXIES = [
  {
    name: "AllOrigins",
    buildUrl: (feedUrl) => `https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`
  },
  {
    name: "CORSProxy",
    buildUrl: (feedUrl) => `https://corsproxy.io/?${encodeURIComponent(feedUrl)}`
  },
  {
    name: "CodeTabs",
    buildUrl: (feedUrl) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(feedUrl)}`
  }
];

let feeds = [];
let activeRequestId = 0;

async function loadFeedConfig() {
  const response = await fetch(CONFIG_XML_PATH);

  if (!response.ok) {
    throw new Error("No se pudo cargar el archivo feeds.xml");
  }

  const xmlText = await response.text();
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = xml.querySelector("parsererror");

  if (parserError) {
    throw new Error("El archivo feeds.xml no tiene un formato XML valido");
  }

  return [...xml.querySelectorAll("feed")].map((feed) => ({
    name: feed.getAttribute("name")?.trim() || "Portal sin nombre",
    source: feed.getAttribute("source")?.trim() || "Fuente desconocida",
    url: feed.querySelector("url")?.textContent?.trim() || ""
  })).filter((feed) => feed.url);
}

function setStatus(message) {
  statusNode.textContent = message;
}

function setLoadingState(isLoading) {
  reloadButton.disabled = isLoading;
  selector.disabled = isLoading;
  reloadButton.textContent = isLoading ? "Cargando..." : "Actualizar noticias";
}

function renderEmptyState(message) {
  newsGrid.innerHTML = `<div class="panel empty-state">${message}</div>`;
}

function populateSelector(items) {
  selector.innerHTML = "";

  items.forEach((feed, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${feed.name} (${feed.source})`;
    selector.appendChild(option);
  });
}

function formatDate(rawDate) {
  const parsed = new Date(rawDate);

  if (Number.isNaN(parsed.getTime())) {
    return "Fecha no disponible";
  }

  return parsed.toLocaleString("es-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function getTextContent(parent, selectors) {
  for (const selectorText of selectors) {
    const node = parent.querySelector(selectorText);

    if (node?.textContent?.trim()) {
      return node.textContent.trim();
    }
  }

  return "";
}

function getTextContentByLocalNames(parent, localNames) {
  const elements = [...parent.getElementsByTagName("*")];

  for (const element of elements) {
    const localName = (element.localName || element.tagName || "").toLowerCase();

    if (localNames.includes(localName) && element.textContent?.trim()) {
      return element.textContent.trim();
    }
  }

  return "";
}

function getLinkFromItem(item) {
  const directLink = getTextContent(item, ["link"]);

  if (directLink) {
    return directLink;
  }

  const atomLink = item.querySelector("link[href]");
  return atomLink?.getAttribute("href")?.trim() || "#";
}

function getAttributeFromLocalNames(parent, localNames, attributeName) {
  const elements = [...parent.getElementsByTagName("*")];

  for (const element of elements) {
    const localName = (element.localName || element.tagName || "").toLowerCase();

    if (localNames.includes(localName)) {
      const value = element.getAttribute(attributeName)?.trim();

      if (value) {
        return value;
      }
    }
  }

  return "";
}

function getCandidateImagesFromMarkup(text) {
  if (!text?.trim()) {
    return [];
  }

  const html = new DOMParser().parseFromString(text, "text/html");
  return [...html.querySelectorAll("img")]
    .map((image) => ({
      src: image.getAttribute("src")?.trim() || "",
      width: Number(image.getAttribute("width") || 0),
      height: Number(image.getAttribute("height") || 0)
    }))
    .filter((image) => image.src);
}

function chooseBestImage(candidates) {
  const blockedPatterns = [
    "feedburner",
    "feedsportal",
    "doubleclick",
    "analytics",
    "tracking",
    "pixel",
    "blank.gif",
    "mf.gif",
    "ads"
  ];

  const validCandidates = candidates.filter((candidate) => {
    const src = candidate.src.toLowerCase();
    const tooSmall = (candidate.width > 0 && candidate.width <= 5) || (candidate.height > 0 && candidate.height <= 5);

    if (tooSmall) {
      return false;
    }

    return !blockedPatterns.some((pattern) => src.includes(pattern));
  });

  if (!validCandidates.length) {
    return "";
  }

  validCandidates.sort((left, right) => {
    const leftArea = (left.width || 0) * (left.height || 0);
    const rightArea = (right.width || 0) * (right.height || 0);
    return rightArea - leftArea;
  });

  return validCandidates[0].src;
}

function getImageFromItem(item) {
  const enclosureUrl = [...item.getElementsByTagName("enclosure")]
    .find((node) => node.getAttribute("type")?.startsWith("image/"))
    ?.getAttribute("url")?.trim();

  if (enclosureUrl) {
    return enclosureUrl;
  }

  const mediaUrl = getAttributeFromLocalNames(
    item,
    ["content", "thumbnail"],
    "url"
  );

  if (mediaUrl) {
    return mediaUrl;
  }

  const contentValue = getAttributeFromLocalNames(item, ["content"], "src");

  if (contentValue) {
    return contentValue;
  }

  const richText = getTextContentByLocalNames(item, ["encoded", "description", "summary", "content"]);
  return chooseBestImage(getCandidateImagesFromMarkup(richText));
}

function clampWords(text, maxWords) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "Sin descripcion";
  }

  const words = normalized.split(" ");

  if (words.length <= maxWords) {
    return normalized;
  }

  return `${words.slice(0, maxWords).join(" ")}...`;
}

function parseRssItems(xmlText, feed) {
  const xml = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = xml.querySelector("parsererror");

  if (parserError) {
    throw new Error("El RSS recibido no es un XML valido");
  }

  const itemNodes = [...xml.querySelectorAll("item, entry")];

  if (!itemNodes.length) {
    throw new Error("El XML del portal no contiene noticias compatibles");
  }

  return itemNodes.slice(0, MAX_NEWS).map((item) => ({
    source: feed.source,
    title: getTextContent(item, ["title"]) || "Sin titulo",
    description: clampWords(
      getTextContentByLocalNames(item, ["description", "summary", "content", "encoded"]).replace(/<[^>]*>/g, "").trim(),
      MAX_DESCRIPTION_WORDS
    ),
    image: getImageFromItem(item),
    link: getLinkFromItem(item),
    pubDate: formatDate(getTextContentByLocalNames(item, ["pubdate", "published", "updated"]))
  }));
}

function renderNews(items) {
  newsGrid.innerHTML = "";

  if (!items.length) {
    renderEmptyState("No se han encontrado noticias para este portal.");
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const card = template.content.firstElementChild.cloneNode(true);
    const image = card.querySelector(".news-image");
    card.querySelector(".news-source").textContent = item.source;
    card.querySelector(".news-title").textContent = item.title;
    card.querySelector(".news-date").textContent = item.pubDate;
    card.querySelector(".news-description").textContent = item.description;
    const link = card.querySelector(".news-link");
    link.href = item.link;

    if (item.image) {
      image.src = item.image;
      image.alt = `Imagen de la noticia: ${item.title}`;
    } else {
      image.remove();
    }

    fragment.appendChild(card);
  });

  newsGrid.appendChild(fragment);
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store"
    });
    return response;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchFeedXml(feedUrl) {
  const errors = [];

  for (const proxy of FEED_PROXIES) {
    try {
      const response = await fetchWithTimeout(proxy.buildUrl(feedUrl));

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const xmlText = await response.text();

      if (!xmlText.trim()) {
        throw new Error("respuesta vacia");
      }

      return xmlText;
    } catch (error) {
      const reason = error.name === "AbortError" ? "timeout" : error.message;
      errors.push(`${proxy.name}: ${reason}`);
    }
  }

  throw new Error(`No se pudo descargar el feed. ${errors.join(" | ")}`);
}

async function loadSelectedFeed() {
  if (!feeds.length) {
    return;
  }

  const requestId = ++activeRequestId;
  const currentFeed = feeds[Number(selector.value)] || feeds[0];
  setLoadingState(true);
  setStatus(`Cargando noticias desde ${currentFeed.name}...`);

  try {
    const xmlText = await fetchFeedXml(currentFeed.url);

    if (requestId !== activeRequestId) {
      return;
    }

    const items = parseRssItems(xmlText, currentFeed);
    renderNews(items);
    setStatus(`Mostrando ${items.length} noticias de ${currentFeed.name}.`);
  } catch (error) {
    if (requestId !== activeRequestId) {
      return;
    }

    renderEmptyState("No se pudieron cargar las noticias. El feed o el proxy puede estar temporalmente no disponible.");
    setStatus(error.message);
  } finally {
    if (requestId === activeRequestId) {
      setLoadingState(false);
    }
  }
}

async function init() {
  try {
    feeds = await loadFeedConfig();

    if (!feeds.length) {
      renderEmptyState("El archivo XML no contiene portales configurados.");
      setStatus("No hay feeds disponibles en feeds.xml.");
      return;
    }

    populateSelector(feeds);
    await loadSelectedFeed();
  } catch (error) {
    renderEmptyState("No se pudo iniciar la aplicacion.");
    setStatus(error.message);
  }
}

selector.addEventListener("change", loadSelectedFeed);
reloadButton.addEventListener("click", loadSelectedFeed);

init();
