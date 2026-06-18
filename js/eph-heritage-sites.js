'use strict';

function formatWikidataDate(dateString, precision) {
  if (!dateString) return null;
  
  // Buang tanda + di depan format ISO Wikidata
  let cleanStr = dateString.replace(/^[+-]/, ''); 
  
  // Ambil potongan bagian tahun, bulan, dan hari
  let yearStr  = cleanStr.substring(0, 4);
  let monthStr = cleanStr.substring(5, 7);
  let dayStr   = cleanStr.substring(8, 10);
  let yearNum  = parseInt(yearStr);

  // Kamus bulan Bahasa Indonesia
  const bulanIndo = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  let prec = parseInt(precision) || 9; // Default ke presisi tahunan (9)

  if (prec === 11) {
    // Presisi Hari (Contoh: 1 Januari 2007)
    return `${parseInt(dayStr)} ${bulanIndo[parseInt(monthStr)]} ${yearStr}`;
  } 
  else if (prec === 10) {
    // Presisi Bulan (Contoh: Januari 2007)
    return `${bulanIndo[parseInt(monthStr)]} ${yearStr}`;
  } 
  else if (prec === 9) {
    // Presisi Tahun (Contoh: 2007)
    return yearStr;
  } 
  else if (prec === 8) {
    // Presisi Dekade (Contoh: 1980-an)
    return `${yearStr}-an`;
  } 
  else if (prec === 7) {
    // Presisi Abad (Contoh: Abad ke-20)
    let century = Math.ceil(yearNum / 100);
    return `Abad ke-${century}`;
  } 
  else {
    return yearStr;
  }
}
// ============================================================
// FUNGSI UTAMA (DIOPTIMALKAN)
// ============================================================
function loadPrimaryData() {
  doPreProcessing();

  populateDesignationTypesData()
    .then(() => {
      return populateCoordinatesData().then(populateMapAndIndex);
    })
    .then(() => {
      enableApp(); 

      populateImageAndWikipediaData()
        .then(() => {
          applyIntersectionFilter(true);      
          
          // KUNCI PERBAIKAN: Hapus ingatan panel yang telanjur terbuat kosong
          Object.values(Records).forEach(r => r.panelElem = undefined);
          
          // Perintahkan aplikasi untuk membaca ulang URL dan merender ulang panel dengan data baru
          processHashChange();
        })
        .catch(error => {
          console.warn("Gagal mengambil data Gambar/Wikipedia dari server.", error);
          applyIntersectionFilter(true);      
          
          // Tetap hapus ingatan dan render ulang sebagai cadangan jika terjadi error
          Object.values(Records).forEach(r => r.panelElem = undefined);
          processHashChange();
        });
    })
    .catch(error => {
       console.error("Data utama gagal dimuat. Cek koneksi atau server Wikidata.", error);
       alert("Maaf, server database sedang sibuk. Coba lagi nanti.");
    });
}
function doPreProcessing() {
  let anchorElem = document.getElementById('wdqs-link');
  anchorElem.href = 'https://query.wikidata.org/#' + encodeURIComponent(ABOUT_SPARQL_QUERY);
  processHashChange();
}

function populateDesignationTypesData() {
  return queryWdqsThenProcess(
    SPARQL_QUERY_0,
    function(result) {
      let qid = result.siteQid.value;
      if (!(qid in Records)) {
        Records[qid] = new Record(false);
      }
      let record = Records[qid];

      if ('siteLabel' in result && result.siteLabel.value) {
        record.title = result.siteLabel.value;
      } else {
        record.title = '[ERROR: No title]';
      }

      let designationQid = result.designationQid.value;
      if ('partOf' in DESIGNATION_TYPES[designationQid]) {
        designationQid = DESIGNATION_TYPES[designationQid].partOf;
      }
      if (!(designationQid in record.designations)) {
        record.designations[designationQid] = new Designation();
      }
      
if ('p131LokasiLabel' in result && result.p131LokasiLabel.value) {
        record.lokasiSpesifik = result.p131LokasiLabel.value;
      }

      if ('p131Image' in result && result.p131Image.value) {
        record.lokasiImage = extractImageFilename(result.p131Image);
      }

      // LOGIKA TAHUN BERDIRI (P571) & PRESISI
if (!record.tahunBerdiri && result.tahunBerdiriMentah && result.tahunBerdiriMentah.value) {
        let precision = result.tahunPresisi ? result.tahunPresisi.value : 9;
        record.tahunBerdiri = formatWikidataDate(result.tahunBerdiriMentah.value, precision);
        
        // KODE BARU: Simpan string waktu mentah (ISO) untuk keperluan sorting usia
        // (Pastikan baris ini berada DI DALAM kurung kurawal 'if')
        record.rawTahunBerdiri = result.tahunBerdiriMentah.value.replace(/^[+-]/, '');
      }

// === KODE BARU: LOGIKA KLASTER MASJID PENTING (DIOPTIMALKAN) ===
      // Langsung tangkap kesimpulan dari server Wikidata
      let statusKlaster = result.isKlasterPenting ? result.isKlasterPenting.value : "false";
      
      if (statusKlaster === "true") {
        record.masukKlasterPenting = true;
      }
      // ==============================================================

    },
    function() {
      populateDesignationIndex();
      SparqlValuesClause = 'VALUES ?site {' + Object.keys(Records).map(qid => `wd:${qid}`).join(' ') + '}';
      Object.values(Records).forEach(record => { record.indexTitle = record.title });
    },
  );
}

function populateCoordinatesData() {
  return queryWdqsThenProcess(
    SPARQL_QUERY_1,
    function(result) {
      let record = Records[result.siteQid.value];
      let wktBits = result.coord.value.split(/\(|\)| /);
      record.lat = parseFloat(wktBits[2]);
      record.lon = parseFloat(wktBits[1]);
    },
    function() {
      BootstrapDataIsLoaded = true;
    },
  );
}

function populateImageAndWikipediaData() {
  return queryWdqsThenProcess(
    SPARQL_QUERY_3,
    function(result) {
      let record = Records[result.siteQid.value];
      
      if ('image' in result) {
        if (!record.imageFilename) {
          record.imageFilename = extractImageFilename(result.image);
        }
      }
      
      if ('wikipediaUrlTitle' in result) {
        record.articleTitle = decodeURIComponent(result.wikipediaUrlTitle.value);
      }
    },
  );
}
// ====================================================================
// FUNGSI JARING 3: Mengambil Peristiwa Penting Saat Diklik (Fase 5)
// ====================================================================
function populateImportantEventsData(qid) {
  let record = Records[qid];
  let queryStr = getSparqlQuery4(qid);

  record.events = []; 

  // TAMBAHAN: Daftar whitelist peristiwa yang diizinkan tampil
  const ALLOWED_EVENTS = [
    'konstruksi', 
    'dibuka untuk umum', 
    'upacara pembukaan', 
    'renovasi', 
    'pembangunan kembali'
  ];

  return queryWdqsThenProcess(
    queryStr,
    function(result) {
      if ('eventLabel' in result && result.eventLabel.value) {
        let labelKecil = result.eventLabel.value.toLowerCase();
        
        // TAMBAHAN: Filter, hanya proses jika label masuk dalam ALLOWED_EVENTS
        if (ALLOWED_EVENTS.includes(labelKecil)) {
          
          // TAMBAHAN: Ambil data tahun mentah (untuk cadangan pengurutan jika ada 2 peristiwa sejenis)
          let rawDateStr = (result.pointInTime ? result.pointInTime.value : null) || 
                           (result.startTime ? result.startTime.value : null) || 
                           (result.endTime ? result.endTime.value : null);
          let extractYear = rawDateStr ? parseInt(rawDateStr.match(/([+-]?\d{4,})/)[0]) : 9999;

          // TAMBAHAN: Masukkan sortYear ke dalam objek
          let eventObj = { label: result.eventLabel.value, time: '', sortYear: extractYear };
          
          let pt = result.pointInTime ? formatWikidataDate(result.pointInTime.value, result.ptPrecision ? result.ptPrecision.value : 9) : null;
          let st = result.startTime ? formatWikidataDate(result.startTime.value, result.stPrecision ? result.stPrecision.value : 9) : null;
          let et = result.endTime ? formatWikidataDate(result.endTime.value, result.etPrecision ? result.etPrecision.value : 9) : null;

          if (pt) {
            eventObj.time = pt;
          } else if (st && et) {
            eventObj.time = `${st}–${et}`;
          } else if (st) {
eventObj.time = `${st} (dimulai)`; // Mengubah format mulai
          } else if (et) {
eventObj.time = `${et} (diselesaikan)`; // Mengubah format selesai
          }

          let isDuplicate = record.events.some(e => e.label === eventObj.label && e.time === eventObj.time);
          if (!isDuplicate) record.events.push(eventObj);
        }
      }
    },
function() {
      // Alih-alih merender, kita lanjutkan tarik data Status & Kapasitas
      populateStatusAndCapacityData(qid); 
    }
  );
}

// ====================================================================
// FUNGSI JARING 4: Mengambil Status & Kapasitas (Berantai)
// ====================================================================
function populateStatusAndCapacityData(qid) {
  let record = Records[qid];
  let queryStr = getSparqlQuery6(qid); // Memanggil kueri yang mengambil P5817 & P1083

  // Siapkan penampung kosong
  record.kondisi = null;
  record.kapasitas = null;

  return queryWdqsThenProcess(
    queryStr,
    function(result) {
      if ('kondisiLabel' in result && result.kondisiLabel.value) {
        record.kondisi = result.kondisiLabel.value;
      }
      if ('kapasitas' in result && result.kapasitas.value) {
        record.kapasitas = result.kapasitas.value;
      }
    },
    function() {
      // Setelah semua data (Peristiwa, Kondisi, Kapasitas) terkumpul, RENDER!
      renderDynamicDataInPanel(qid); 
    }
  );
}

// ====================================================================
// FUNGSI RENDER: Menyuntikkan Data Peristiwa (DIPERBAIKI)
// ====================================================================
// ====================================================================
// FUNGSI RENDER: Menyuntikkan Peristiwa, Status, & Kapasitas
// ====================================================================
function renderDynamicDataInPanel(qid) {
  let record = Records[qid];
  
  if (!record.panelElem) return;
  // Kita tetap menggunakan ID container events sebagai patokan loader
  let container = record.panelElem.querySelector(`#events-container-${qid}`);
  if (!container) return; 

  let html = '';
  let wikiBaseUrl = `https://www.wikidata.org/wiki/${qid}`;

  // --- URUTAN 1: PERISTIWA PENTING ---
  if (record.events && record.events.length > 0) {
    const EVENT_ORDER = {
      'konstruksi': 1, 'dibuka untuk umum': 2,
      'upacara pembukaan': 3, 'renovasi': 4,
      'pembangunan kembali': 5
    };

    record.events.sort((a, b) => {
      let orderA = EVENT_ORDER[a.label.toLowerCase()] || 99;
      let orderB = EVENT_ORDER[b.label.toLowerCase()] || 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.sortYear - b.sortYear;
    });

let tautanSuntingEvent = `<a href="${wikiBaseUrl}#P793" target="_blank" class="sunting-link" title="Sunting peristiwa di Wikidata"></a>`;

    record.events.forEach(ev => {
      let capLabel = ev.label.charAt(0).toUpperCase() + ev.label.slice(1);
      let timeText = ev.time ? ev.time : ''; 
      html += `<p>${capLabel}: ${timeText}${tautanSuntingEvent}</p>`;
    });
  }

  // --- URUTAN 2: STATUS (KONDISI - P5817) ---
  if (record.kondisi) {
    let kondisiKecil = record.kondisi.toLowerCase();
    let tautanSuntingKondisi = `<a href="${wikiBaseUrl}#P5817" target="_blank" class="sunting-link" title="Sunting kondisi di Wikidata"></a>`;
    html += `<p>Kondisi: ${kondisiKecil}${tautanSuntingKondisi}</p>`;
  }

  // --- URUTAN 3: KAPASITAS JEMAAH (P1083) ---
  if (record.kapasitas) {
    let formatAngka = parseInt(record.kapasitas).toLocaleString('id-ID');
    let tautanSuntingKapasitas = `<a href="${wikiBaseUrl}#P1083" target="_blank" class="sunting-link" title="Sunting kapasitas di Wikidata"></a>`;
    html += `<p>Kapasitas: ${formatAngka} jemaah${tautanSuntingKapasitas}</p>`;
  }

  // --- URUTAN 4: TAUTAN TAMBAHKAN DATA LAINNYA (Tampil Default) ---
  let tautanTambah = `<p><a href="${wikiBaseUrl}" target="_blank" class="sunting-linktambah" title="Tambahkan data di Wikidata">Tambahkan data lainnya</a></p>`;
  html += tautanTambah;

  // --- EKSEKUSI RENDER & HAPUS LOADER ---
  container.insertAdjacentHTML('beforebegin', html);
  container.remove();
}

function populateDesignationIndex() {
  DesignationIndex = { all: new DesignationIndexEntry };
  Object.keys(DESIGNATION_TYPES)
    .filter(qid => !('partOf' in DESIGNATION_TYPES[qid]))
    .forEach(qid => {
      DesignationIndex[qid] = new DesignationIndexEntry;
      let orgId = DESIGNATION_TYPES[qid].org;
      if (!(orgId in DesignationIndex)) DesignationIndex[orgId] = new DesignationIndexEntry;
    });

  Object.values(Records).forEach(record => {
    DesignationIndex.all.total++;
    Object.keys(record.designations).forEach(typeQid => {
      let orgId = DESIGNATION_TYPES[typeQid].org;
      DesignationIndex[typeQid].total++;
      DesignationIndex[orgId  ].total++;
    });
  });
}

function populateMapAndIndex() {
  let listIndex = document.getElementById('index-list');
  let mapMarkers = [];
  Object.entries(Records).forEach(entry => {
    let qid = entry[0], record = entry[1];
    if (!record.isCompound && record.lat && record.lon) {
      let mapMarker = L.marker(
        [record.lat, record.lon],
        { icon: L.ExtraMarkers.icon({ icon: '', markerColor : 'orange-dark' }) },
      );
      record.mapMarker = mapMarker;
      mapMarker.bindPopup(record.title, { closeButton: false });
      let popup = mapMarker.getPopup();
      popup._qid = qid;
      record.popup = popup;
      mapMarkers.push(mapMarker);
    }
    let li = document.createElement('li');
    li.innerHTML = `<a href="#${qid}">${record.indexTitle}</a>`;
    record.indexLi = li;
    listIndex.appendChild(li);
  });
  Cluster.addLayers(mapMarkers);
  populateDesignationIndexNodes();
  generateFilterSelect();
}

function populateDesignationIndexNodes() {
  Object.values(Records).forEach(record => {
    if (record.mapMarker) DesignationIndex.all.mapMarkers.push(record.mapMarker);
    DesignationIndex.all.indexLis.push(record.indexLi);
    
    Object.keys(record.designations).forEach(typeQid => {
      let orgId = DESIGNATION_TYPES[typeQid].org;
      
      // KODE BARU: Memberikan stempel tag wilayah ke setiap record
      record.areaTags.add(typeQid);
      record.areaTags.add(orgId);

      if (record.mapMarker) {
        DesignationIndex[typeQid].mapMarkers.push(record.mapMarker);
        DesignationIndex[orgId  ].mapMarkers.push(record.mapMarker);
      }
      DesignationIndex[typeQid].indexLis.push(record.indexLi);
      DesignationIndex[orgId  ].indexLis.push(record.indexLi);
    });
  });
  
  Object.values(DesignationIndex).forEach(indexItem => {
    indexItem.indexLis = indexItem.indexLis
      .map(li => [li, li.textContent])
      .sort((a, b) => a[1] > b[1] ? 1 : -1)
      .map(item => item[0]);
  });
}

// Variabel State Global
let currentRegionFilter = 'all';
let currentUsiaFilter = 'all';
let activeFeatures = new Set(); 
let currentSearchQuery = '';

function generateFilterSelect() {
  let selectRegion = document.getElementById('filter-region');
  let selectSort = document.getElementById('sort-order');

 
  // 1. Bangun Master Dropdown (Wilayah)
  selectRegion.innerHTML = `<option value="all">Semua Wilayah – ${DesignationIndex.all.total}</option>`;
  
  Object.keys(DESIGNATION_TYPES)
    .filter(qid => !('partOf' in DESIGNATION_TYPES[qid]))
    .map(qid => [qid, DESIGNATION_TYPES[qid].order]) 
    .sort((a, b) => a[1] - b[1])
    .map(item => item[0])
    .forEach(qid => {
      let type = DESIGNATION_TYPES[qid];
      let option = document.createElement('option');
      option.value = qid;
      option.textContent = `${type.name} – ${DesignationIndex[qid].total}`;
      selectRegion.appendChild(option);
    });

applyIntersectionFilter(true);
  
  // 2. Event Listener Wilayah
  selectRegion.addEventListener('change', function() {
    currentRegionFilter = this.value;
    applyIntersectionFilter();
  });

  // =======================================================
  // KODE BARU: Pengendali Dropdown Kombinasi (Sort + Filter)
  // =======================================================
let selectKombinasi = document.getElementById('filter-sort-kombinasi');
  if (selectKombinasi) {
    selectKombinasi.addEventListener('change', function() {
      let pilihan = this.value;

      // 1. Reset variabel ke kondisi bawaan
      currentUsiaFilter = 'all';

      // 2. Tentukan aksi berdasarkan opsi yang dipilih
      if (pilihan === 'filter-usia-50') {
        currentUsiaFilter = 'usia_50'; 
      } 
      else if (pilihan === 'filter-klaster') {
        currentUsiaFilter = 'klaster_penting';
      }
      else if (pilihan === 'default') {
        // Biarkan saja, otomatis kembali ke semua data dan urut abjad
      }
      // 3. Eksekusi ulang tampilan
      applyIntersectionFilter();
    });
  }
  // =======================================================

  // 4. Event Listener Tombol Fitur Toggle
  let btnAll = document.getElementById('btn-all');
  let featButtons = document.querySelectorAll('.feat-btn:not(#btn-all)');

  btnAll.addEventListener('click', function() {
    activeFeatures.clear();
    btnAll.classList.add('active');
    featButtons.forEach(b => b.classList.remove('active'));
    applyIntersectionFilter();
  });

  featButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      let filterType = this.getAttribute('data-filter');

      if (activeFeatures.has(filterType)) {
        activeFeatures.delete(filterType);
        this.classList.remove('active');
      } else {
        activeFeatures.add(filterType);
        this.classList.add('active');
      }

      if (activeFeatures.size === 0) {
        btnAll.classList.add('active');
      } else {
        btnAll.classList.remove('active');
      }

      applyIntersectionFilter();
    });
  });

  let searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      // Simpan teks menjadi huruf kecil semua agar pencarian tidak sensitif huruf besar/kecil
      currentSearchQuery = this.value.toLowerCase();
      applyIntersectionFilter(); // Terapkan filter dan perbarui peta/daftar
    });
  }
}

// GANTILAH KESELURUHAN FUNGSI LAMA DENGAN INI:
// Sekarang fungsi ini wajib menerima "kiriman" angka dari luar (variabel totalValidRecords)
function updateFeatureCounts(totalValidRecords) {
  
  let btnAll = document.getElementById('btn-all');
  let btnImg = document.getElementById('btn-image') || document.querySelector('[data-filter="image"]');
  let btnArt = document.getElementById('btn-article') || document.querySelector('[data-filter="article"]');

  if (btnAll) btnAll.textContent = 'Semua Hasil';
  if (btnImg) btnImg.textContent = 'Memiliki Gambar';
  if (btnArt) btnArt.textContent = 'Memiliki Artikel';

  let searchInput = document.getElementById('search-input');
  if (searchInput) {
    // Tulis angka yang dikirimkan ke kotak pencarian
    searchInput.placeholder = `Menampilkan ${totalValidRecords} hasil (atau ketik yang ingin dicari)`;
  }
}

// Gantilah seluruh fungsi applyIntersectionFilter lama Anda dengan ini:
function applyIntersectionFilter(preventZoom = false) {
  Cluster.clearLayers();
  let ol = document.getElementById('index-list');
  ol.innerHTML = '';

  let validMarkers = [];
  
  let validRecords = Object.values(Records).filter(record => {
    let matchRegion = (currentRegionFilter === 'all' || record.areaTags.has(currentRegionFilter));
    let matchFeature = true;
    
    // Cek tombol fitur
    if (activeFeatures.size > 0) {
      if (activeFeatures.has('image') && !record.imageFilename) matchFeature = false;
      if (activeFeatures.has('article') && record.articleTitle === undefined) matchFeature = false;
    }

    // Cek pencarian teks dengan keamanan ekstra
    let matchSearch = true;
    if (currentSearchQuery.trim() !== '') {
      if (record.indexTitle) {
        matchSearch = record.indexTitle.toLowerCase().includes(currentSearchQuery);
      } else {
        matchSearch = false;
      }
    }

    // === Cek Filter Usia / Klaster ===
    let matchUsia = true;
    if (currentUsiaFilter === 'klaster_penting') {
      matchUsia = record.masukKlasterPenting === true;
    }
    else if (currentUsiaFilter === 'usia_50') {
      if (record.rawTahunBerdiri) {
        let tahunBangunan = parseInt(record.rawTahunBerdiri.substring(0, 4));
        let batasTahun = new Date().getFullYear() - 50;
        matchUsia = tahunBangunan <= batasTahun;
      } else {
        matchUsia = false;
      }
    }
    
    // === TAMBALAN UTAMA 1: BARIS INI YANG SEBELUMNYA HILANG ===
    return matchRegion && matchFeature && matchSearch && matchUsia;

}).sort((a, b) => {
    
    // === KODE BARU: Pengurutan Khusus untuk Opsi > 50 Tahun ===
    // Jika dropdown disetel ke filter usia 50 tahun, urutkan dari yang paling tua
    if (currentUsiaFilter === 'usia_50') {
      let aHasYear = !!a.rawTahunBerdiri;
      let bHasYear = !!b.rawTahunBerdiri;

      if (aHasYear && bHasYear) {
        // String ISO ("1800", "1920") bisa langsung dibandingkan.
        // localeCompare akan menaruh angka terkecil (tahun tertua) di urutan atas.
        return a.rawTahunBerdiri.localeCompare(b.rawTahunBerdiri);
      } else if (aHasYear && !bHasYear) {
        return -1; // Prioritaskan yang punya data tahun di atas
      } else if (!aHasYear && bHasYear) {
        return 1;  // Singkirkan yang tidak punya data tahun ke bawah
      }
    }
    // ==========================================================

    // DEFAULT: Logika Pengurutan Abjad 
    // (Akan otomatis berjalan jika memilih [Pilih] atau [Masjid Besar])
    return a.indexTitle.localeCompare(b.indexTitle);    
    
  });

  validRecords.forEach(record => {
    if (record.mapMarker) validMarkers.push(record.mapMarker);
    if (record.indexLi) ol.appendChild(record.indexLi);
  });

  if (validMarkers.length > 0) {
    Cluster.addLayers(validMarkers);
    
    if (!preventZoom) {
      Map.fitBounds(Cluster.getBounds());
    }
  }
  
updateFeatureCounts(validRecords.length);
}

function activateSite(qid) {
  displayRecordDetails(qid); // Ini akan memicu generateRecordDetails dan memunculkan panel+placeholder
  
  // === INI DIA PEMICUNYA (Fase 5) ===
  // Kedua fungsi ini akan berlari secara asinkronus (bersamaan) 
  // di latar belakang untuk mengisi placeholder yang kosong.
  populateImportantEventsData(qid);
  populateHistoricalImagesData(qid);
  // =================================

  let record = Records[qid];
  if (record.isCompound) {
    // Biarkan kosong sesuai kode aslimu
  }
  else if (record.mapMarker) {
    Cluster.zoomToShowLayer(
      record.mapMarker,
      function() {
        Map.setView([record.lat, record.lon], Map.getZoom());
        if (!record.popup.isOpen()) record.mapMarker.openPopup();
      },
    );
  }
}

function generateRecordDetails(qid) {
  let record = Records[qid];
  let titleHtml = `<h1>${record.title}</h1>`;

  let figureHtml = generateFigure(record.imageFilename);

  if (record.imageFilename) {
    figureHtml = figureHtml.replace('<figure class="', '<figure class="gambar-utama ');
  }

  let articleHtml;
  if (record.articleTitle) {
    articleHtml = '<div class="article main-text loading"><div class="loader"></div></div>';
  }
  else {
    articleHtml = '<div class="article main-text nodata"><p>Situs ini belum memiliki artikel Wikipedia berbahasa Indonesia.</p></div>';
  }
  
  let designationsHtml = '<h2>Ringkasan</h2>';
  designationsHtml += '<ul class="designations">';

  let isFirstDesignation = true; // Mencegah duplikasi container peristiwa

  Object.keys(record.designations)
    .map(qid => [qid, DESIGNATION_TYPES[qid].order]) 
    .sort((a, b) => a[1] - b[1])
    .map(item => item[0])
    .forEach(designationQid => {

let type = DESIGNATION_TYPES[designationQid];

 let infoTahunHtml = '';
// Siapkan URL yang mengarah ke bagian "Tanggal didirikan" (P571)
let wikiUrlTahun = `https://www.wikidata.org/wiki/${qid}#P571`; 

if (record.tahunBerdiri) {
  let tautanSunting = `<a href="${wikiUrlTahun}" target="_blank" class="sunting-link" title="Sunting tahun berdiri di Wikidata"></a>`;
  infoTahunHtml = `<p>Berdiri sejak: ${record.tahunBerdiri}${tautanSunting}</p>`;
} else {
  // Wikipedia juga menggunakan ikon pensil yang sama untuk mengisi data kosong di infobox
  let tautanTambah = `<a href="${wikiUrlTahun}" target="_blank" class="sunting-link" title="Tambahkan tahun berdiri di Wikidata"></a>`;
  infoTahunHtml = `<p>Didirikan: <span style="font-style: italic; color: #888;">Data belum tersedia</span>${tautanTambah}</p>`;
}

      // --- LOGIKA LOKASI ANTI-DOBEL ---
      let induk = type.name; 
      let spesifik = record.lokasiSpesifik; 
      let namaLokasi = induk; // Default: "Kota Padang"

      // Jika data kecamatan/nagari ada, DAN tidak dobel/identik dengan nama kabupaten/kota (abaikan huruf besar/kecil)
      if (spesifik && spesifik.toLowerCase() !== induk.toLowerCase()) {
        namaLokasi = `${spesifik}, ${induk}`; // Contoh hasil: "Kecamatan Banuhampu, Kabupaten Agam"
      }

      let infoLokasiHtml = '';

      if (record.lat && record.lon) {
        // Tautan Google Maps baku
        let mapsUrl = `https://www.google.com/maps?q=${record.lat},${record.lon}`;
        infoLokasiHtml = `<p class="koordinat-link">Terletak di <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" title="Buka di Google Maps">${namaLokasi}</a></p>`;
      } else {
        infoLokasiHtml = `<p class="koordinat-link">Terletak di: ${namaLokasi}</p>`;
      }
      
      // --- LOADER VISUAL KEMBALI DI SINI ---
      let eventsHtmlPlaceholder = '';
      if (isFirstDesignation) {
        // Kontainer utama (wajib ada agar JS bisa menyuntikkan <p> ke mari) dilengkapi animasi loader mini
        eventsHtmlPlaceholder = `
          <div id="events-container-${qid}" class="loading" style="margin-top: 8px; min-height: 24px;">
            <div class="loader" style="width: 20px; height: 20px; border-width: 2px; margin: 0;"></div>
          </div>`;
        isFirstDesignation = false;
      }
      // -------------------------------------

      designationsHtml +=
        '<li>' +
          '<div class="org">' +
            `<img src="img/org_logo_${type.org.toLowerCase()}.svg">` + 
          '</div>' +
          infoLokasiHtml + 
          infoTahunHtml +
          eventsHtmlPlaceholder + // Placeholder peristiwa & loader disisipkan di sini
        '</li>';
        
    });
    
  designationsHtml += '</ul>';

  // ====================================================================
  // PLACEHOLDER ARSIP
  // ====================================================================
  let arsipHtml = `<div id="arsip-container-${qid}" class="loading"><div class="loader" style="width: 20px; height: 20px; border-width: 2px; margin: 0;"></div></div>`;

  let panelElem = document.createElement('div');
  
  panelElem.innerHTML =
    `<a class="main-wikidata-link" href="https://www.wikidata.org/wiki/${qid}" target="_blank" title="Lihat di Wikidata">` +
    '<img src="img/wikidata_tiny_logo.png" alt="[Lihat item Wikidata]" /></a>' +
    titleHtml +
    figureHtml + 
    articleHtml +
    designationsHtml + 
    arsipHtml;

  record.panelElem = panelElem;

  if (record.articleTitle) displayArticleExtract(record.articleTitle, panelElem.querySelector('.article'));
  queryOsm(qid);
}

// ====================================================================
// FUNGSI JARING 4: Mengambil Arsip Foto & Keterangan Saat Diklik
// ====================================================================
function populateHistoricalImagesData(qid) {
  let record = Records[qid];
  let queryStr = getSparqlQuery5(qid); 

  // Bersihkan memori setiap kali diklik agar tidak menumpuk ganda
  record.vicinityImages = [];
  record.pastImage = undefined;

  return queryWdqsThenProcess(
    queryStr,
    function(result) {
      // 1. Ambil gambar lingkungan (Bisa Banyak)
      if ('vicinityImage' in result) {
        let filename = extractImageFilename(result.vicinityImage);
        let captionText = result.vicinityCaption ? result.vicinityCaption.value : '';
        
        let isDuplicate = record.vicinityImages.some(img => img.file === filename);
        if (!isDuplicate) {
          record.vicinityImages.push({ file: filename, caption: captionText });
        }
      }
      
      // 2. Ambil gambar masa lalu (Hanya 1)
      if ('pastImage' in result) {
        if (!record.pastImage) { // Palang pintu: hanya ambil jika belum ada
          let filename = extractImageFilename(result.pastImage);
          let captionText = result.pastCaption ? result.pastCaption.value : '';
          record.pastImage = { file: filename, caption: captionText };
        }
      }
    },
    function() {
      renderHistoricalImagesInPanel(qid);
    }
  );
}

// ====================================================================
// FUNGSI RENDER: Menyuntikkan Arsip Foto & Keterangan
// ====================================================================
function renderHistoricalImagesInPanel(qid) {
  let record = Records[qid];
  
  if (!record.panelElem) return;
  let container = record.panelElem.querySelector(`#arsip-container-${qid}`);
  if (!container) return; 

  let html = '';
  
  // Mesin pembuat blok HTML
  function buildImageBlock(imgObj) {
    // KUNCI PERUBAHAN: Memasang border-top langsung di div pembungkus.
    // padding-top: 20px diberikan agar ada jarak nafas antara garis dan foto.
    let block = '<div class="arsip-block" style="overflow: hidden;">';
    
    // Cetak fotonya terlebih dahulu
    block += generateFigure(imgObj.file);
    
    // Cetak teks keterangannya di bawah foto (jika ada)
    if (imgObj.caption) {
      block += `<div class="article main-text"><p>${imgObj.caption}</p></div>`;
    }
    
    // Tutup bungkus div
    block += '</div>';
    
    return block;
  }

  // 1. Cetak SATU gambar masa lalu
  if (record.pastImage) {
    html += buildImageBlock(record.pastImage);
  }
  
  // 2. Cetak BANYAK gambar lingkungan
  if (record.vicinityImages && record.vicinityImages.length > 0) {
    record.vicinityImages.forEach(imgObj => {
      html += buildImageBlock(imgObj);
    });
  }

  // Finalisasi penempelan ke layar
  if (html !== '') {
    // KUNCI PERUBAHAN: H2 "Arsip & Foto Lingkungan" sudah dihapus
container.innerHTML = '<h2 style="margin-bottom:15px;">Galeri</h2>' + html;
    container.classList.remove('loading');
  } else {
    container.innerHTML = '';
    container.classList.remove('loading');
    container.style.display = 'none';
  }
}
function displayArticleExtract(title, elem) {
  loadJsonp(
    'https://id.wikipedia.org/w/api.php',
    {
      action    : 'query',
      format    : 'json',
      prop      : 'extracts',
      exintro   : 1,
      redirects : true,
      titles    : title,
    },
    function(data) {
      elem.innerHTML =
        Object.values(data.query.pages)[0].extract.match(/<p[^]+?<\/p>/g).find(text => text.length > 50) +
        '<p class="wikipedia-link">' +
          `<a href="https://id.wikipedia.org/wiki/${encodeURIComponent(title)}" target="_blank">` +
            '<img src="img/wikipedia_tiny_logo.png" alt="" />' +
            '<span>Baca selengkapnya di Wikipedia</span>' +
          '</a>' +
        '</p>';
      elem.classList.remove('loading');
    }
  );
}

function queryOsm(qid) {
  let xhr = new XMLHttpRequest();
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== xhr.DONE) return;
    if (xhr.status === 200) {
      let geoJson = osmtogeojson(JSON.parse(xhr.responseText));
      if (!geoJson || geoJson.features.length === 0) return;
      let shapeLayer = L.geoJSON(
        geoJson,
        {
          style: {
            color   : '#ff3333',
            opacity : 0.7,
            fill    : true,
          },
          filter: feature => feature.geometry.type !== 'Point',
        },
      );
      Records[qid].shapeLayer = shapeLayer;
      shapeLayer.addTo(Map);

      if (window.location.hash.replace('#', '') === qid) {
        Map.fitBounds(shapeLayer.getBounds());
      }
    }
    else {
      console.log('ERROR loading from Overpass API', xhr);
    }
  };
  xhr.open(
    'GET',
    'https://overpass-api.de/api/interpreter?data=' +
    encodeURIComponent(
`[out:json][timeout:25];
(
  way     ["wikidata"="${qid}"];
  relation["wikidata"="${qid}"];
);
out body;
>;
out skel qt;`
    ),
    true,
  );
  xhr.send();
}

// ============================================================
// CLASSES
// ============================================================
class Designation {
  constructor() {
    this.date             = undefined;
  }
}

class DesignationIndexEntry {
  constructor() {
    this.total      = 0;
    this.mapMarkers = [];
    this.indexLis   = [];
  }
}

class Record {
  constructor(isCompound) {

    this.isCompound = isCompound;

    this.title = undefined;

    this.imageFilename = '';

    this.articleTitle = undefined;

    this.designations = {};

    this.panelElem = undefined;

    this.indexLi = undefined;

    this.tahunBerdiri = undefined;

    this.rawTahunBerdiri = undefined;

    this.events = [];

    this.areaTags = new Set();

    this.vicinityImages = [];
    this.masukKlasterPenting = false;
  }
}

class SimpleRecord extends Record {
  constructor() {
    super(false);
    this.lat        = undefined;
    this.lon        = undefined;
    this.mapMarker  = undefined;
    this.popup      = undefined;
    this.shapeLayer = undefined;
  }
}

class CompoundRecord extends Record {
  constructor() {
    super(true);
    this.parts = []; 
  }
}
