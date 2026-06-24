'use strict';

const WDQS_API_URL            = 'https://query.wikidata.org/sparql';
const COMMONS_WIKI_URL_PREF   = 'https://commons.wikimedia.org/wiki/';
const COMMONS_API_URL         = 'https://commons.wikimedia.org/w/api.php';
const YEAR_PRECISION          = '9';
const OSM_LAYER_URL           = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_LAYER_ATTRIBUTION   = 'Base map © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const CARTO_LAYER_URL         = 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png';
const CARTO_LAYER_ATTRIBUTION = 'Base map © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (data), <a href="https://carto.com/">CARTO</a> (style)';
const TILE_LAYER_MAX_ZOOM     = 16;

const MIN_PH_LAT              =   6.0;   
const MAX_PH_LAT              = -11.0;   
const MIN_PH_LON              =  95.0;   
const MAX_PH_LON              = 141.0;   

var Records = {};        
var ProvinceIndex = {};  
var SparqlValuesClause;  
var Map;                 
var Cluster;             
var BootstrapDataIsLoaded = false;  
var PrimaryDataIsLoaded   = false;  

// === FITUR BARU: Buku Tamu Pencatat Koneksi Aktif ===
var activeXhrs = [];

window.addEventListener('load', init);

function init() {
  initMap();
  setupLandingForm();
  window.addEventListener('hashchange', processHashChange);
  Map.on('popupopen', function(e) { displayRecordDetails(e.popup._qid) });
  
  window.location.hash = ''; 
  setTimeout(function() {
    window.location.hash = 'landing';
  }, 50);
}

function setupLandingForm() {
  let dropdown = document.getElementById('jenis-dropdown');
  let inputTxt = document.getElementById('jenis-input');
  let btnMulai = document.getElementById('btn-mulai');

  if (!dropdown || !inputTxt || !btnMulai) return;

  dropdown.addEventListener('change', function() {
    if (this.value === 'custom') {
      inputTxt.value = 'wd:Q'; 
      inputTxt.readOnly = false;
      inputTxt.style.backgroundColor = '#ffffff';
      inputTxt.focus();
    } else {
      inputTxt.value = this.value;
      inputTxt.readOnly = true;
      inputTxt.style.backgroundColor = '#f5f5f5';
    }
  });

  btnMulai.addEventListener('click', function() {
    let finalValue = inputTxt.value.trim();
    if (finalValue === '' || finalValue === 'wd:Q') {
      alert('Tolong masukkan parameter Q-ID yang benar sayang :)');
      return;
    }
    
    resetApp();
    
    window.location.hash = '';
    displayPanelContent('loading');
    loadPrimaryData();
  });
}

function resetApp() {
  // === FITUR BARU: Sang Pembunuh Koneksi (XHR Abort) ===
  if (activeXhrs.length > 0) {
    activeXhrs.forEach(xhr => xhr.abort());
    activeXhrs = []; // Kosongkan daftar setelah dibunuh
  }

  Records = {};
  ProvinceIndex = {};
  BootstrapDataIsLoaded = false;
  PrimaryDataIsLoaded = false;
  
  currentFilteredRecords = [];
  currentRenderIndex = 0;

  if (Cluster) {
    Cluster.clearLayers();
  }

  let indexList = document.getElementById('index-list');
  if (indexList) indexList.innerHTML = '';
}

function initMap() {
  Map = new L.map('map', { zoomControl: false });
  Map.fitBounds([[MAX_PH_LAT, MAX_PH_LON], [MIN_PH_LAT, MIN_PH_LON]]);

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
  L.control.zoom({ position: 'bottomright' }).addTo(Map);
  L.control.locate({ position: 'bottomright', showCompass: false, strings: { title: "Tunjukkan lokasi saya" } }).addTo(Map);

  let powered = L.control({ position: 'bottomleft' });
  powered.onAdd = function(Map) {
    var divElem = L.DomUtil.create('div', 'powered');
    divElem.innerHTML = '<a href="https://www.wikidata.org/"><img src="img/powered_by_wikidata.png"></a>';
    return divElem;
  };
  powered.addTo(Map);

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

function queryWdqsThenProcess(query, processEachResult, postprocessCallback) {
  let promise = new Promise((resolve, reject) => {
    let xhr = new XMLHttpRequest();
    
    // Daftarkan koneksi ini ke Buku Tamu
    activeXhrs.push(xhr);

    xhr.onreadystatechange = function() {
      if (xhr.readyState !== xhr.DONE) return;

      // Hapus dari Buku Tamu karena tugasnya sudah selesai
      let index = activeXhrs.indexOf(xhr);
      if (index > -1) activeXhrs.splice(index, 1);

      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText));
      } else if (xhr.status === 0) {
        // Status 0 berarti koneksi sengaja dibunuh (aborted) atau terputus
        reject('ABORTED');
      } else {
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

function enableApp() {
  PrimaryDataIsLoaded = true;
  processHashChange();
}

function processHashChange() {
  let fragment = window.location.hash.replace('#', '');

  // Tarik panel ke atas secara otomatis di Mobile
  if (typeof window.setMobilePanelExpanded === 'function') {
    window.setMobilePanelExpanded(true);
  }

  // 1. Halaman Beranda (Landing)
  if (fragment === 'landing') {
    resetApp(); // Pastikan memori bersih setiap kali kembali ke Beranda
    document.title = 'Mulai Eksplorasi – ' + BASE_TITLE;
    displayPanelContent('landing');
  }
  // 2. Halaman Tentang
  else if (fragment === 'about') {
    document.title = 'About – ' + BASE_TITLE;
    displayPanelContent('about');
  }
  // 3. Halaman Kontributor
  else if (fragment === 'kontrib') {
    document.title = 'Jadi Kontributor – ' + BASE_TITLE;
    displayPanelContent('kontrib'); 
  }
  // 4. Halaman Daftar (Index) & Detail Bangunan
  else {
    // === KUNCI PERBAIKAN: CEK APAKAH DATA SUDAH DITARIK? ===
    if (!PrimaryDataIsLoaded) {
      
      if (fragment === '') {
        // Jika pengguna menekan tab "Daftar" tapi belum ada data
        document.title = 'Daftar Kosong – ' + BASE_TITLE;
        
        let indexList = document.getElementById('index-list');
        if (indexList) {
          // Suntikkan pesan Empty State yang cantik
          indexList.innerHTML = `
            <div style="padding: 40px 20px; text-align: center; line-height: 1.6;">
              <h3 style="margin-bottom: 10px; color: #333;">Data Belum Ditarik</h3>
              <p style="color: #666; margin-bottom: 25px;">Anda belum melakukan pencarian. Silakan pilih jenis entitas dan mulai eksplorasi Anda di halaman Beranda.</p>
              <a href="#landing" style="background-color: #d32f2f; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">Kembali ke Beranda</a>
            </div>
          `;
        }
        displayPanelContent('index');
      } else {
        // Jika pengguna iseng mengetik URL bangunan secara manual tapi belum narik data
        // Lempar paksa kembali ke Landing!
        window.location.hash = 'landing';
      }
      
    } 
    // === JIKA DATA SUDAH BERHASIL DITARIK ===
    else {
      if (fragment === '' || !(fragment in Records)) {
        window.location.hash = '';  
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

function generateFigure(filename, title = "Situs", classNames = []) {
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
          licenseHtml = metadata.LicenseShortName.value.replace(/ /g, ' ');
          licenseHtml = licenseHtml.replace(/-/g, '‑');
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
  } else {
    let namaAmanURL = encodeURIComponent(title);
    let gFormFotoUrl = `https://docs.google.com/forms/d/e/1FAIpQLSd7_u-7yCwDtXIkDO--bILry6mWGoRCnnfSumL_PEjfle0aLg/viewform?usp=pp_url&entry.2138396049=${namaAmanURL}`;
    return `<figure class="${classNames.join(' ')} nodata">Belum ada foto. <a href="${gFormFotoUrl}" target="_blank" rel="noopener noreferrer" style="border:none;" class="sunting-linktambah">Tambahkan!</a></figure>`;
  }
}

function extractImageFilename(image) {
  let regex = /https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//;
  return decodeURIComponent(image.value.replace(regex, ''));
}

function parseDate(result, keyName) {
  let dateVal = result[keyName].value;
  if (result[keyName + 'Precision'].value === YEAR_PRECISION) {
    return dateVal.substr(0, 4);
  } else {
    let date = new Date(dateVal);
    return date.toLocaleDateString('en-US', { month : 'long', day : 'numeric', year : 'numeric' });
  }
}
