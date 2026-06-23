'use strict';

// Constants and fixed parameters
const WDQS_API_URL            = 'https://query.wikidata.org/sparql';
const COMMONS_WIKI_URL_PREF   = 'https://commons.wikimedia.org/wiki/';
const COMMONS_API_URL         = 'https://commons.wikimedia.org/w/api.php';
const YEAR_PRECISION          = '9';
const OSM_LAYER_URL           = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_LAYER_ATTRIBUTION   = 'Base map &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const CARTO_LAYER_URL         = 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png';
const CARTO_LAYER_ATTRIBUTION = 'Base map &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (data), <a href="https://carto.com/">CARTO</a> (style)';
const TILE_LAYER_MAX_ZOOM     = 16;

// KOORDINAT SKALA NASIONAL (INDONESIA)
const MIN_PH_LAT              =   6.0;   // Ujung Utara (Weh)
const MAX_PH_LAT              = -11.0;   // Ujung Selatan (Rote)
const MIN_PH_LON              =  95.0;   // Ujung Barat (Sabang)
const MAX_PH_LON              = 141.0;   // Ujung Timur (Merauke)

// Globals
var Records = {};        // Main app database, keyed by QID
var ProvinceIndex = {};  // Objek penampung kategori provinsi dinamis
var SparqlValuesClause;  // SPARQL "VALUES" clause containing the QIDs of all main Wikidata items
var Map;                 // Leaflet map object
var Cluster;             // Leaflet map cluster
var BootstrapDataIsLoaded = false;  // Whether the data needed to populate the map and index is loaded
var PrimaryDataIsLoaded   = false;  // Whether the non-lazy data is loaded

// ------------------------------------------------------------

window.addEventListener('load', init);

// Initializes the app once the page has been loaded.
function init() {
  initMap();
  
  // 1. TAHAN TARIKAN DATA OTOMATIS (Dinonaktifkan)
  // loadPrimaryData(); 
  
  // 2. PASANG PENDETEKSI FORMULIR GERBANG
  setupLandingForm();

  window.addEventListener('hashchange', processHashChange);
  Map.on('popupopen', function(e) { displayRecordDetails(e.popup._qid) });
  
  // 3. PAKSA MUNCULKAN HALAMAN LANDING SAAT PERTAMA DIBUKA
  window.location.hash = 'landing';
}

// KODE BARU: Pengendali Formulir Gerbang Utama
function setupLandingForm() {
  let dropdown = document.getElementById('jenis-dropdown');
  let inputTxt = document.getElementById('jenis-input');
  let btnMulai = document.getElementById('btn-mulai');

  if (!dropdown || !inputTxt || !btnMulai) return;

  // Jika dropdown diganti
  dropdown.addEventListener('change', function() {
    if (this.value === 'custom') {
      inputTxt.value = 'wd:Q'; // Teks pancingan awal
      inputTxt.readOnly = false;
      inputTxt.style.backgroundColor = '#ffffff';
      inputTxt.focus();
    } else {
      inputTxt.value = this.value;
      inputTxt.readOnly = true;
      inputTxt.style.backgroundColor = '#f5f5f5';
    }
  });

  // Jika tombol Cari ditekan
  btnMulai.addEventListener('click', function() {
    let finalValue = inputTxt.value.trim();
    if (finalValue === '' || finalValue === 'wd:Q') {
      alert('Tolong masukkan parameter Q-ID yang benar sayang :)');
      return;
    }
    
    // Ubah hash URL untuk masuk ke panel loading lalu mulai tarik data
    window.location.hash = '';
    displayPanelContent('loading');
    loadPrimaryData();
  });
}

// Initializes the Leaflet-based map.
function initMap() {
  Map = new L.map('map', { zoomControl: false });
  Map.fitBounds([[MAX_PH_LAT, MAX_PH_LON], [MIN_PH_LAT, MIN_PH_LON]]);

  // Add tile layers
  let cartoLayer = new L.tileLayer(CARTO_LAYER_URL, {
    attribution : CARTO_LAYER_ATTRIBUTION,
    maxZoom     : TILE_LAYER_MAX_ZOOM,
  }).addTo(Map);
  let osmLayer = new L.tileLayer(OSM_LAYER_URL, {
    attribution : OSM_LAYER_ATTRIBUTION,
    maxZoom     : TILE_LAYER_MAX_ZOOM,
  });
  let baseMaps = {
    'CARTO Voyager'       : cartoLayer,
    'OpenStreetMap Carto' : osmLayer,
  };
  
  L.control.layers(baseMaps, null, {position: 'topleft'}).addTo(Map);

  L.control.zoom({
    position: 'bottomright'
  }).addTo(Map);

  L.control.locate({
    position: 'bottomright',
    showCompass: false,
    strings: {
        title: "Tunjukkan lokasi saya"
    }
  }).addTo(Map);

  // Add powered by Wikidata map control
  let powered = L.control({ position: 'bottomleft' });
  powered.onAdd = function(Map) {
    var divElem = L.DomUtil.create('div', 'powered');
    divElem.innerHTML =
      '<a href="https://www.wikidata.org/"><img src="img/powered_by_wikidata.png"></a>';
    return divElem;
  };
  powered.addTo(Map);

  // Initialize the map marker cluster
  Cluster = new L.markerClusterGroup({
    maxClusterRadius: function(z) {
      if (z <=  15) return 50;
      if (z === 16) return 40;
      if (z === 17) return 30;
      if (z === 18) return 20;
      if (z >=  19) return 10;
    },
  }).addTo(Map);
}

// Given a SPARQL query string...
function queryWdqsThenProcess(query, processEachResult, postprocessCallback) {
  let promise = new Promise((resolve, reject) => {
    let xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== xhr.DONE) return;
      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText));
      }
      else {
        reject(xhr.status);
      }
    };
    xhr.open('POST', WDQS_API_URL, true);
    xhr.overrideMimeType('text/plain');
    xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    xhr.setRequestHeader('Api-User-Agent', 'WikiSurau/1.0 (mailto:rahmatdenas@gmail.com)');
    if (SparqlValuesClause) query = query.replace('<SPARQLVALUESCLAUSE>', SparqlValuesClause);
    xhr.send('format=json&query=' + encodeURIComponent(query));
  });

  promise = promise.then(data => {
    data.results.bindings.forEach(processEachResult);
  });

  if (postprocessCallback) promise = promise.then(postprocessCallback);

  return promise;
}

// Enables the app. Should be called after the Wikidata queries have been processed.
function enableApp() {
  PrimaryDataIsLoaded = true;
  processHashChange();
}

// Event handler that handles any change in the window URL hash.
function processHashChange() {
  let fragment = window.location.hash.replace('#', '');

  if (fragment === 'landing') {
    document.title = 'Mulai Eksplorasi – ' + BASE_TITLE;
    displayPanelContent('landing');
  }
  else if (fragment === 'about') {
    document.title = 'About – ' + BASE_TITLE;
    displayPanelContent('about');
  }
  else if (fragment === 'kontrib') {
    document.title = 'Jadi Kontributor – ' + BASE_TITLE;
    displayPanelContent('kontrib'); 
  }
  else {
    if (!BootstrapDataIsLoaded) {
      displayPanelContent('loading');
    }
    else {
      if (fragment === '' || !(fragment in Records)) {
        window.location.hash = '';  // Disable invalid fragments
        document.title = BASE_TITLE;
        displayPanelContent('index');
      }
      else {
        activateMapMarker(fragment);
        displayRecordDetails(fragment);
      }
    }
  }
}

// Given a record QID, if the record has a map marker, updates the map...
function activateMapMarker(qid) {
  let record = Records[qid];
  if (!record.mapMarker) return; 
  Cluster.zoomToShowLayer(
    record.mapMarker,
    function() {
      Map.setView([record.lat, record.lon], Map.getZoom());
      if (!record.popup.isOpen()) record.mapMarker.openPopup();
    },
  );
}

// Given the ID of the panel content ID, displays the corresponding panel content...
function displayPanelContent(id) {
  document.querySelectorAll('.panel-content').forEach(content => {
    content.style.display = (content.id === id) ? content.dataset.display : 'none';
  });
  document.querySelectorAll('nav li').forEach(li => {
    if (li.childNodes[0].getAttribute('href') === '#' + id) {
      li.classList.add('selected');
    }
    else {
      li.classList.remove('selected');
    }
  });
}

// Given a record QID, displays the record's details on the side panel...
function displayRecordDetails(qid) {
  let record = Records[qid];
  window.location.hash = `#${qid}`;
  document.title = `${record.indexTitle} – ${BASE_TITLE}`;
  
  if (PrimaryDataIsLoaded) {
    if (!record.panelElem) {
      generateRecordDetails(qid); 
      
      if (typeof populateImportantEventsData === 'function') {
        populateImportantEventsData(qid);
      }
      if (typeof populateHistoricalImagesData === 'function') {
        populateHistoricalImagesData(qid);
      }
    }
    
    let detailsElem = document.getElementById('details');
    detailsElem.replaceChild(record.panelElem, detailsElem.childNodes[0]);
    displayPanelContent('details');
  }
  else {
    displayPanelContent('loading');
  }
}

// Given a Commons image filename and an array of class names, generates a figure HTML string...
function generateFigure(filename, title = "Bangunan", classNames = []) {
  if (filename) {
    let uniqueId = 'caption-' + Math.random().toString(36).substr(2, 9);

    loadJsonp(
      COMMONS_API_URL,
      {
        action : 'query',
        format : 'json',
        prop   : 'imageinfo',
        iiprop : 'extmetadata',
        titles : 'File:' + filename,
      },
      function(data) {
        let metadata = Object.values(data.query.pages)[0].imageinfo[0].extmetadata;
        
        let artistHtml = '';
        if (metadata.Artist) {
            artistHtml = metadata.Artist.value.trim();
            artistHtml = artistHtml.replace(/<(?!\/?a ?)[^>]+>/g, '');
            artistHtml = artistHtml.replace(/Unknown authorUnknown author/gi, 'Tak diketahui');
            artistHtml = artistHtml.replace(/UnknownUnknown/gi, 'Tak diketahui');
            
            if (artistHtml.search('href="//') >= 0) {
              artistHtml = artistHtml.replace(/href="(?:https?:)?\/\//g, 'href="https://');
            }
            artistHtml = artistHtml.replace(/<a /gi, '<a target="_blank" ');
        }

        let licenseHtml = '';
        if (metadata.AttributionRequired && metadata.AttributionRequired.value === 'true') {
          licenseHtml = metadata.LicenseShortName.value.replace(/ /g, '&nbsp;');
          licenseHtml = licenseHtml.replace(/-/g, '&#8209;');
          licenseHtml = `[${licenseHtml}]`;
          if (metadata.LicenseUrl) {
            licenseHtml = `<a href="${metadata.LicenseUrl.value}" target="_blank">${licenseHtml}</a>`;
          }
          licenseHtml = ' ' + licenseHtml;
        }

        let targetCaption = document.getElementById(uniqueId);
        if (targetCaption) {
            targetCaption.innerHTML = artistHtml + licenseHtml;
        }
      }
    );

    let encodedFilename = encodeURIComponent(filename);
    return (
      `<figure class="${classNames.join(' ')}">` +
        `<a href="${COMMONS_WIKI_URL_PREF}File:${encodedFilename}" target="_blank">` +
          `<img class="loading" src="${COMMONS_WIKI_URL_PREF}Special:FilePath/${encodedFilename}?width=500" alt="" onload="this.className=''">` +
        '</a>' +
        `<figcaption id="${uniqueId}">(Loading…)</figcaption>` +
      '</figure>'
    );
  }
else {
let namaAmanURL = encodeURIComponent(title);
    let gFormFotoUrl = `https://docs.google.com/forms/d/e/1FAIpQLSd7_u-7yCwDtXIkDO--bILry6mWGoRCnnfSumL_PEjfle0aLg/viewform?usp=pp_url&entry.2138396049=${namaAmanURL}`;
    return `<figure class="${classNames.join(' ')} nodata">Belum ada foto. <a href="${gFormFotoUrl}" target="_blank" rel="noopener noreferrer" style="border:none;" class="sunting-linktambah">Tambahkan!</a></figure>`;
  }
}

// Given a WDQS query result image data, returns the base image filename.
function extractImageFilename(image) {
  let regex = /https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//;
  return decodeURIComponent(image.value.replace(regex, ''));
}

// Given a WDQS result record and key name, takes the date value based on the key name...
function parseDate(result, keyName) {
  let dateVal = result[keyName].value;
  if (result[keyName + 'Precision'].value === YEAR_PRECISION) {
    return dateVal.substr(0, 4);
  }
  else {
    let date = new Date(dateVal);
    return date.toLocaleDateString(
      'en-US',
      {
        month : 'long',
        day   : 'numeric',
        year  : 'numeric',
      },
    );
  }
}
