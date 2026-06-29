'use strict';

const CHUNK_SIZE = 35;
var currentRenderIndex = 0;
var currentFilteredRecords = [];
var isFilterEventAttached = false; 

// Fungsi pembelah array menjadi potongan kecil (Batching)
function potongJadiKelompok(array, ukuran) {
  let hasilPotongan = [];
  for (let i = 0; i < array.length; i += ukuran) {
    hasilPotongan.push(array.slice(i, i + ukuran));
  }
  return hasilPotongan;
}

function formatWikidataDate(dateString, precision) {
  if (!dateString) return null;  
  let cleanStr = dateString.replace(/^[+-]/, '');   
  let yearStr  = cleanStr.substring(0, 4);
  let monthStr = cleanStr.substring(5, 7);
  let dayStr   = cleanStr.substring(8, 10);
  let yearNum  = parseInt(yearStr);
  const bulanIndo = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  let prec = parseInt(precision) || 9; 
  if (prec === 11) {
    return `${parseInt(dayStr)} ${bulanIndo[parseInt(monthStr)]} ${yearStr}`;
  } 
  else if (prec === 10) {
    return `${bulanIndo[parseInt(monthStr)]} ${yearStr}`;
  } 
  else if (prec === 9) {
    return yearStr;
  } 
  else if (prec === 8) {
    return `${yearStr}-an`;
  } 
  else if (prec === 7) {
    let century = Math.ceil(yearNum / 100);
    return `abad ke-${century}`;
  } 
  else {
    return yearStr;
  }
}

function loadPrimaryData() {
  doPreProcessing();

  populateProvinceTypesData() 
    .then(() => {
      return populateCoordinatesData().then(populateMapAndIndex);
    })
    .then(() => {
      enableApp(); 
      populateImageAndWikipediaData()
        .then(() => {
          applyIntersectionFilter(); 
          Object.values(Records).forEach(r => r.panelElem = undefined);          
          processHashChange();
        })
        .catch(error => {
          if (error === 'ABORTED') return;
          
          console.warn("Gagal mengambil data Gambar/Wikipedia dari server.", error);
          applyIntersectionFilter();             
          Object.values(Records).forEach(r => r.panelElem = undefined);
          processHashChange();
        });
    })
    // ==========================================
    // PERBAIKAN DI BLOK CATCH INI
    // ==========================================
    .catch(error => {
       if (error === 'ABORTED') {
         console.log("Pencarian dibatalkan secara paksa. Kembali ke Beranda.");
         return;
       }

       // 1. Matikan status memuat agar animasi berhenti
       isFetching = false;
       PrimaryDataIsLoaded = false;

       // 2. Tampilkan pesan error di panel daftar (menggantikan alert bawaan browser)
       let indexList = document.getElementById('index-list');
       if (indexList) {
         indexList.innerHTML = `
           <div style="padding: 40px 20px; text-align: center; line-height: 1.6;">
             <h3 style="margin-bottom: 10px; margin-top:0; color: #cc0000;">Koneksi Terputus</h3>
             <p style="color: #666; font-size:14px; margin-bottom: 25px;">Gagal mengambil data dari server Wikidata. Pastikan koneksi internet Anda stabil atau coba lagi nanti saat server tidak sibuk.</p>
             <a href="#landing" style="background-color: #882222; color: #fff; font-size:11px; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: 800; display: inline-block;">Kembali ke Beranda</a>
           </div>
         `;
       }
       
       console.error("Data utama gagal dimuat. Cek koneksi atau server Wikidata.", error);
    });
}

function doPreProcessing() {
  let anchorElem = document.getElementById('wdqs-link');
  anchorElem.href = 'https://query.wikidata.org/#' + encodeURIComponent(ABOUT_SPARQL_QUERY);
  processHashChange();
}

var currentKategoriUtama = 'general'; 
var currentNamaKlaster = 'Objek';     // Penampung nama klaster
var currentNamaWilayah = 'Semua Wilayah'; // Penampung nama daerah

function tentukanKategoriKueri(inputTxt) {
  let teks = inputTxt.toUpperCase(); 
  
  // Kategori Alam (Semua ini akan mematikan fitur "Didirikan")
const kelompokAlam = [
    'Q34770', // Bahasa
    'Q19861951', 'Q746549', 'Q2095', 'Q8195619', // Hidangan
    'Q11460', 'Q3172759', 'Q28823', // Pakaian
    'Q107357104', 'Q184485', // Tari & Pertunjukan
    'Q189819', 'Q2627975', // Ritual & Upacara
    'Q36192', // Budaya rakyat
    'Q22746', 'Q174782', // RTH
    'Q43501', 'Q167346', // Kebun binatang & tanaman
    'Q179049', // Cagar alam
    'Q8502', // Gunung
    'Q35509', // Gua
    'Q23442', // Pulau
    'Q34038', // Air terjun
    'Q23397', 'Q204324', 'Q159954', // Danau & kaldera
    'Q40080', 'Q570116', // Pantai & Objek Wisata (Q193475 Dihapus dari sini)
    'Q131681', 'Q12323' // Waduk, bendungan, embung
  ];
  // Regex \b digunakan agar Q8502 tidak terpanggil di dalam teks Q850299 dll
  let isAlam = kelompokAlam.some(qid => new RegExp(`\\b${qid}\\b`).test(teks));
  if (isAlam) return 'alam';
  return 'general';
}

function dapatkanNamaKlaster(inputTxt) {
  let teks = inputTxt.toUpperCase();
  const cek = (qids) => qids.some(qid => new RegExp(`\\b${qid}\\b`).test(teks));
  
  // Pengecualian Khusus
  if (cek(['Q3199141', 'Q3191695'])) return 'Wilayah Administratif';
  if (cek(['Q5'])) return 'Tokoh';
  if (cek(['Q47461344']) && cek(['Q7725634'])) return 'Publikasi'; // Sepaket
  if (cek(['Q7725634']) && !cek(['Q47461344'])) return 'Latar karya sastra';
  if (cek(['Q3305213'])) return 'Lukisan';
  if (cek(['Q1641020'])) return 'Lontar';
  if (cek(['Q87167'])) return 'Naskah';
  if (cek(['Q11032', 'Q41298'])) return 'Media massa';
  if (cek(['Q7944', 'Q8070'])) return 'Gempa bumi dan tsunami';
  if (cek(['Q8065', 'Q3839081', 'Q7692360', 'Q8068'])) return 'Bencana lainnya';
  if (cek(['Q1190554'])) return 'Peristiwa lainnya';
  if (cek(['Q1323212', 'Q3199915', 'Q198', 'Q645883', 'Q831663', 'Q180684', 'Q178561', 'Q1261499'])) return 'Perang & konflik';

  // Kategori Alam / Kebudayaan Non-Bangunan
  if (cek(['Q34770'])) return 'Bahasa';
  if (cek(['Q19861951', 'Q746549', 'Q2095', 'Q8195619'])) return 'Hidangan';
  if (cek(['Q11460', 'Q3172759', 'Q28823'])) return 'Pakaian';
  if (cek(['Q107357104', 'Q184485'])) return 'Tari dan pertunjukan';
  if (cek(['Q189819', 'Q2627975'])) return 'Ritual dan upacara';
  if (cek(['Q36192'])) return 'Budaya rakyat';
  if (cek(['Q22746', 'Q174782'])) return 'Ruang terbuka hijau';
  if (cek(['Q43501', 'Q167346'])) return 'Kebun binatang & tanaman';
  if (cek(['Q179049'])) return 'Cagar alam';
  if (cek(['Q8502'])) return 'Gunung';
  if (cek(['Q35509'])) return 'Gua';
  if (cek(['Q23442'])) return 'Pulau';
  if (cek(['Q34038'])) return 'Air terjun';
  if (cek(['Q23397', 'Q204324', 'Q159954'])) return 'Danau & kaldera';
if (cek(['Q40080'])) return 'Pantai'; 
  if (cek(['Q570116'])) return 'Objek wisata';
  if (cek(['Q131681', 'Q12323'])) return 'Waduk, bendungan, & embung';

  // Klaster Bangunan & Fasilitas (Non-Alam Default)
  if (cek(['Q32815', 'Q56235676', 'Q56235673', 'Q1454820'])) return 'Masjid';
  if (cek(['Q137894610', 'Q35112127', 'Q4246737', 'Q19860854', 'Q109607'])) return 'Bangunan bersejarah';
  if (cek(['Q16970', 'Q2977', 'Q56242215'])) return 'Gereja & katedral';
  if (cek(['Q5393308', 'Q2680845'])) return 'Vihara & kelenteng';
  if (cek(['Q16917'])) return 'Rumah sakit';
  if (cek(['Q3918', 'Q38723'])) return 'Universitas & kampus';
  if (cek(['Q7075'])) return 'Perpustakaan';
  if (cek(['Q33506'])) return 'Museum';
  if (cek(['Q16560', 'Q481289'])) return 'Istana';
  if (cek(['Q1248784'])) return 'Bandar udara';
  if (cek(['Q55488'])) return 'Stasiun kereta api';
  if (cek(['Q44782'])) return 'Pelabuhan';
  if (cek(['Q494829'])) return 'Terminal bus';
  if (cek(['Q483110', 'Q2310214'])) return 'Stadion & lapangan olahraga';
  if (cek(['Q44539', 'Q2736554', 'Q842402', 'Q3124902'])) return 'Kuil & candi';
  if (cek(['Q57821', 'Q1785071', 'Q91122'])) return 'Benteng dan bunker';
  if (cek(['Q330284', 'Q11315'])) return 'Pasar dan mall';
  if (cek(['Q27686', 'Q875157'])) return 'Hotel dan resor';
  if (cek(['Q4989906', 'Q321053', 'Q179700', 'Q170980', 'Q5003624'])) return 'Monumen, patung, & memorial';
  if (cek(['Q178743', 'Q1640824'])) return 'Prasasti';
  if (cek(['Q839954', 'Q193475'])) return 'Situs arkeologi';
  if (cek(['Q220659', 'Q860861'])) return 'Artefak';

  return 'Objek'; 
}

// Fungsi baru untuk menentukan P-ID berdasarkan nama klaster
function dapatkanPropertiWikidata(namaKlaster) {
  const pakaiP276 = [
    'Hidangan', 'Pakaian', 'Tari dan pertunjukan', 'Ritual dan upacara', 
    'Budaya rakyat', 'Lukisan', 'Lontar', 'Naskah', 'Artefak', 'Gempa bumi dan tsunami', 'Peristiwa lainnya', 'Perang & konflik', 'Bencana lainnya'
  ];
  if (pakaiP276.includes(namaKlaster)) return 'P276';   
  if (['Bahasa'].includes(namaKlaster)) return 'P2341'; // Wilayah penutur asli
  if (['Tokoh'].includes(namaKlaster)) return 'P19'; // Tempat lahir
  if (['Publikasi', 'Media massa'].includes(namaKlaster)) return 'P291'; // Tempat terbit
  if (['Latar karya sastra'].includes(namaKlaster)) return 'P840'; // Latar naratif
  
  // Default untuk semua
  return 'P131'; 
}

// Fungsi penentu Properti Tahun/Waktu
function dapatkanPropertiTahun(namaKlaster) {
  if (['Gempa bumi dan tsunami', 'Peristiwa lainnya', 'Perang & konflik', 'Bencana lainnya'].includes(namaKlaster)) return 'P585'; // Tanggal kejadian (Point in time)
  if (['Tokoh'].includes(namaKlaster)) return 'P569'; // Tanggal lahir
  if (['Publikasi', 'Media massa', 'Latar karya sastra'].includes(namaKlaster)) return 'P577'; // Tanggal terbit
  if (['Lukisan'].includes(namaKlaster)) return 'P571'; // Tanggal diciptakan
  
  // Default untuk Bangunan, Wilayah, dll
  return 'P571'; // Didirikan / Inception
}

// Di dalam populateProvinceTypesData (JS 2)
function populateProvinceTypesData() {
  let inputTxt = document.getElementById('jenis-input').value.trim();
  let provDropdown = document.getElementById('provinsi-input');
  let provInput = provDropdown.value;
  
  // 1. Simpan Data Global 
  currentKategoriUtama = tentukanKategoriKueri(inputTxt);
  currentNamaKlaster = dapatkanNamaKlaster(inputTxt); 
  currentNamaWilayah = provDropdown.options[provDropdown.selectedIndex].text;
  
  // 2. RENDER LOADING LANGSUNG DI SINI SECARA UTUH
  let indexList = document.getElementById('index-list');
  if (indexList) {
    indexList.innerHTML = `
      <div style="padding: 40px 20px; text-align: center; line-height: 1.6;">
        <h3 id="loading-text" style="margin-bottom: 10px; margin-top:0; color: #333;">
          Sedang Menarik Data ${currentNamaKlaster} di ${currentNamaWilayah}...
        </h3>
        <p style="color: #666; font-size:14px; margin-bottom: 25px;">Mohon tunggu sebentar, Wikidata sedang mencari dan menyusun daftar entitas untuk Anda.</p>
        <div class="loader" style="margin: 0 auto; width: 40px; height: 40px; border-width: 4px;"></div>
      </div>
    `;
  }
  
  let baseQuery = KUMPULAN_KUERI_0['universal'];
  let propLokasi = dapatkanPropertiWikidata(currentNamaKlaster);
  let propTahun = dapatkanPropertiTahun(currentNamaKlaster);
  let wilayahClause1 = '';
  let unionEkstra = ''; 
  let hierarkiLokasi = '?p131Lokasi wdt:P131* ?provinsi .'; 
  
  // === VARIABEL BUKA-TUTUP KURUNG ===
  let kurungBuka = '';
  let kurungTutup = '';

  if (provInput === 'all') {
    wilayahClause1 = '?provinsi wdt:P31 wd:Q5098 .';
    // Karena tidak ada UNION, kurung biarkan kosong!
  } else {
    wilayahClause1 = `?provinsi wdt:P131 ${provInput}.`;
    let wilayahClause2 = `BIND(${provInput} AS ?provinsi) BIND(${provInput} AS ?p131Lokasi)`; 
    
    // Karena ada UNION, kita wajib memanggil kurung kurawal pembungkus
    kurungBuka = '{';
    kurungTutup = '}';
    
    unionEkstra = `
    UNION {
      ${wilayahClause2}
      ?site wdt:P31 ?jenis ;
            wdt:${propLokasi} ?p131Lokasi .
    }`;
  }
  
  let dynamicQuery = baseQuery
    .replace(/<PLACEHOLDER_KURUNG_BUKA>/g, kurungBuka)     // Eksekusi Buka Kurung
    .replace(/<PLACEHOLDER_KURUNG_TUTUP>/g, kurungTutup)   // Eksekusi Tutup Kurung
    .replace(/<PLACEHOLDER_WILAYAH_1>/g, wilayahClause1)
    .replace(/<PLACEHOLDER_PROP_LOKASI>/g, propLokasi)
    .replace(/<PLACEHOLDER_PROP_TAHUN>/g, propTahun)
    .replace(/<PLACEHOLDER_HIERARKI_LOKASI>/g, hierarkiLokasi)
    .replace(/<PLACEHOLDER_UNION_EKSTRA>/g, unionEkstra) 
    .replace(/<PLACEHOLDER_JENIS>/g, inputTxt);

  console.log("Kueri 0 (Tipe & Provinsi) yang dikirim:", dynamicQuery);

  return queryWdqsThenProcess(
    dynamicQuery,
    function(result) {
      let qid = result.siteQid.value;
      if (!(qid in Records)) Records[qid] = new Record(false);
      let record = Records[qid];

      record.title = ('siteLabel' in result && result.siteLabel.value) ? result.siteLabel.value : '[ERROR: No title]';

      let provQid = result.provinsiQid ? result.provinsiQid.value : 'Q_UNKNOWN';
      let provLabel = result.provinsiLabel ? result.provinsiLabel.value : 'Tidak dalam Provinsi';

      if (!(provQid in ProvinceIndex)) {
        ProvinceIndex[provQid] = new ProvinceIndexEntry();
        ProvinceIndex[provQid].name = provLabel; 
      }
      if (!(provQid in record.designations)) record.designations[provQid] = provLabel; 
      
      record.areaTags.add(provQid);
      
      if ('p131LokasiLabel' in result && result.p131LokasiLabel.value) record.lokasiSpesifik = result.p131LokasiLabel.value;
      if ('p131Image' in result && result.p131Image.value) record.lokasiImage = extractImageFilename(result.p131Image);
      
      if (!record.tahunBerdiri && result.tahunBerdiriMentah && result.tahunBerdiriMentah.value) {
        let precision = result.tahunPresisi ? result.tahunPresisi.value : 9;
        record.tahunBerdiri = formatWikidataDate(result.tahunBerdiriMentah.value, precision);        
        record.rawTahunBerdiri = result.tahunBerdiriMentah.value.replace(/^[+-]/, '');
      }
    },
    function() {
      populateProvinceIndex(); 
      Object.values(Records).forEach(record => { record.indexTitle = record.title });
    },
  );
}

function populateCoordinatesData() {
  let daftarQid = Object.keys(Records).map(id => 'wd:' + id);
  if (daftarQid.length === 0) return Promise.resolve();

  // Ambil nama klaster untuk menentukan jalurnya
  let inputTxt = document.getElementById('jenis-input').value.trim();
  let namaKlaster = dapatkanNamaKlaster(inputTxt);
  
  let templateKueri = KUMPULAN_KUERI_1['universal'];
  
  // 1. Ambil P-ID menggunakan fungsi yang sudah kita buat sebelumnya
  let propLokasi = dapatkanPropertiWikidata(namaKlaster); 
  
  // 2. Daftarkan klaster apa saja yang TIDAK PUNYA koordinat langsung (Cek lagi Lukisan Lontar dan Naskah?)
  const klasterTanpaKoordinatLangsung = [
    'Hidangan', 'Pakaian', 'Tari dan pertunjukan', 'Ritual dan upacara', 
    'Budaya rakyat', 'Lukisan', 'Lontar', 'Naskah', 'Perang & konflik',
    'Tokoh', 'Bahasa', 'Publikasi', 'Media massa', 'Latar karya sastra'
  ];

  let klausaKoordinat = '';

// 3. Logika percabangan yang baru
  if (!klasterTanpaKoordinatLangsung.includes(namaKlaster)) {
    // Jika BANGUNAN atau ALAM FISIK (Gunung, Pantai), cari koordinat langsung (P625)
    klausaKoordinat = `?site p:P625 ?coordStatement .`;
  } else {
    // Jika BUDAYA, TOKOH, atau BENDA BERGERAK, cari lokasinya dulu, baru ambil koordinatnya
    klausaKoordinat = `
    ?site wdt:${propLokasi} ?p131Lokasi .
    
    # KUNCI PERBAIKAN: Kecualikan Indonesia (Q252) agar tidak mengambil koordinat tengah laut/negara
    FILTER(?p131Lokasi != wd:Q252) 
    
    ?p131Lokasi p:P625 ?coordStatement .`;
  }

  let kelompokCicilan = potongJadiKelompok(daftarQid, 1000);

  let daftarJanji = kelompokCicilan.map(cicilan => {
    let teksQids = cicilan.join(' ');
    let kueriFinal = templateKueri
      .replace(/<PLACEHOLDER_QIDS>/g, teksQids)
      .replace(/<PLACEHOLDER_KLAUSA_KOORDINAT>/g, klausaKoordinat);

    return queryWdqsThenProcess(
      kueriFinal,
      function(result) {
        let record = Records[result.siteQid.value];
        if (!record) return; 

        let wktBits = result.coord.value.split(/\(|\)| /);
        record.lat = parseFloat(wktBits[2]);
        record.lon = parseFloat(wktBits[1]);
      }
    );
  });

  return Promise.all(daftarJanji).then(function() {
    BootstrapDataIsLoaded = true;
  });
}

function populateImageAndWikipediaData() {
  let daftarQid = Object.keys(Records).map(id => 'wd:' + id);
  if (daftarQid.length === 0) return Promise.resolve();

  let kelompokCicilan = potongJadiKelompok(daftarQid, 1000);

  let daftarJanji = kelompokCicilan.map(cicilan => {
    let teksQids = cicilan.join(' ');
    let kueriFinal = SPARQL_QUERY_3_TEMPLATE.replace('<PLACEHOLDER_QIDS>', teksQids);

    return queryWdqsThenProcess(
      kueriFinal,
      function(result) {
        let record = Records[result.siteQid.value];      
        if (!record) return; 

        if ('image' in result) {
          if (!record.imageFilename) {
            record.imageFilename = extractImageFilename(result.image);
          }
        }      
        if ('wikipediaUrlTitle' in result) {
          record.articleTitle = decodeURIComponent(result.wikipediaUrlTitle.value);
        }
      }
    );
  });

  return Promise.all(daftarJanji);
}

function populateImportantEventsData(qid) {
  let record = Records[qid];
  let queryStr = getSparqlQuery4(qid);

  record.events = []; 

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
        
        if (ALLOWED_EVENTS.includes(labelKecil)) {
          let rawDateStr = (result.pointInTime ? result.pointInTime.value : null) || 
                           (result.startTime ? result.startTime.value : null) || 
                           (result.endTime ? result.endTime.value : null);
          let extractYear = rawDateStr ? parseInt(rawDateStr.match(/([+-]?\d{4,})/)[0]) : 9999;

          let eventObj = { label: result.eventLabel.value, time: '', sortYear: extractYear };
          
          let pt = result.pointInTime ? formatWikidataDate(result.pointInTime.value, result.ptPrecision ? result.ptPrecision.value : 9) : null;
          let st = result.startTime ? formatWikidataDate(result.startTime.value, result.stPrecision ? result.stPrecision.value : 9) : null;
          let et = result.endTime ? formatWikidataDate(result.endTime.value, result.etPrecision ? result.etPrecision.value : 9) : null;

          if (pt) {
            eventObj.time = pt;
          } else if (st && et) {
            eventObj.time = `${st}–${et}`;
          } else if (st) {
            eventObj.time = `${st} (dimulai)`; 
          } else if (et) {
            eventObj.time = `${et} (diselesaikan)`; 
          }

          let isDuplicate = record.events.some(e => e.label === eventObj.label && e.time === eventObj.time);
          if (!isDuplicate) record.events.push(eventObj);
        }
      }
    },
    function() {
      populateStatusAndCapacityData(qid); 
    }
  );
}

function populateStatusAndCapacityData(qid) {
  let record = Records[qid];
  let queryStr = getSparqlQuery6(qid); 

  // Buat objek kosong untuk menampung semua atribut spesifik
  record.dynamicProps = {};

  return queryWdqsThenProcess(
    queryStr,
    function(result) {
      // Looping otomatis: simpan apapun yang berhasil didapat dari Wikidata!
      Object.keys(result).forEach(key => {
        if (key !== 'siteQid' && result[key].value) {
          record.dynamicProps[key] = result[key].value;
        }
      });
    },
    function() {
      renderDynamicDataInPanel(qid); 
    }
  );
}

function renderDynamicDataInPanel(qid) {
  let record = Records[qid];
  
  if (!record.panelElem) return;
  let container = record.panelElem.querySelector(`#events-container-${qid}`);
  if (!container) return; 

  let html = '';
  let wikiBaseUrl = `https://www.wikidata.org/wiki/${qid}`;

  if (record.events && record.events.length > 0) {
    const EVENT_ORDER = {
      'konstruksi': 1, 'dibuka untuk umum': 2,
      'upacara pembukaan': 3, 'renovasi': 4,
      'pembangunan kembali': 5
    };

    record.events.sort((a, b) => {
      if (a.sortYear !== b.sortYear) {
        return a.sortYear - b.sortYear;
      }
      let orderA = EVENT_ORDER[a.label.toLowerCase()] || 99;
      let orderB = EVENT_ORDER[b.label.toLowerCase()] || 99;
      return orderA - orderB;
    });

    record.events.forEach(ev => {
      let capLabel = ev.label.charAt(0).toUpperCase() + ev.label.slice(1);
      let timeText = ev.time ? ev.time : ''; 
      html += `<p>${capLabel}: ${timeText}</p>`;
    });
  }

 // ==========================================
  // RENDER ATRIBUT DINAMIS (KAPASITAS, POPULASI, DLL)
  // ==========================================
  
  // Kamus untuk mengubah kode variabel menjadi Teks Bahasa Indonesia yang rapi di layar
const labelKamus = {
    ketinggian: 'Ketinggian', luas: 'Luas', kapasitas: 'Kapasitas',
    kondisi: 'Kondisi', lamanResmi: 'Laman resmi', fasilitasList: 'Fasilitas',
    arsitek: 'Arsitek', gayaList: 'Gaya arsitektur', populasi: 'Jumlah penduduk',
    kepalaDaerah: 'Kepala daerah', jalurList: 'Jalur penghubung', jumlahKoleksi: 'Jumlah koleksi',
    spesialisasiList: 'Spesialisasi', tglTemu: 'Tanggal penemuan', tempatTemu: 'Lokasi penemuan',
    bahasaList: 'Bahasa', bentukList: 'Bentuk karya', penulisList: 'Penulis/pencipta',
    subjekList: 'Subjek utama', kolektorList: 'Koleksi dari', pemredList: 'Pimpinan redaksi',
    pendiriList: 'Pendiri', penerbit: 'Penerbit', bahanList: 'Bahan/Komposisi',
    caraList: 'Cara pembuatan', penutur: 'Jumlah penutur', tglWafat: 'Tanggal wafat',
    pekerjaanList: 'Pekerjaan', pegunungan: 'Bagian dari pegunungan', korban: 'Korban jiwa',
    agamaList: 'Agama', bagianDari: 'Bagian dari'
  };

  let urlWikibooks = null;

if (record.dynamicProps && Object.keys(record.dynamicProps).length > 0) {
    
    // CEGAT WIKIBOOKS: Simpan ke variabel lalu hapus dari antrean agar tidak diproses looping
    if (record.dynamicProps.wikibooks) {
      urlWikibooks = record.dynamicProps.wikibooks;
      delete record.dynamicProps.wikibooks;
    }

    for (let key in record.dynamicProps) {
      let rawValue = record.dynamicProps[key];
      let formattedValue = rawValue;
      let titleLabel = labelKamus[key] || key; 

      // FORMATTING KHUSUS
      if (key === 'populasi' || key === 'penutur') {
        let [angka, tahun] = rawValue.split('|');
        let angkaRapi = parseInt(angka).toLocaleString('id-ID');
        formattedValue = tahun !== 'null' ? `${angkaRapi} jiwa (${tahun})` : `${angkaRapi} jiwa`;
      } 
      else if (key === 'kepalaDaerah') {
        let [nama, tahun] = rawValue.split('|');
        formattedValue = tahun !== 'null' ? `${nama} (sejak ${tahun})` : nama;
      }
      else if (key === 'luas') {
        let [angka, satuan, bagian] = rawValue.split('|');
        let angkaRapi = parseFloat(angka).toLocaleString('id-ID');
        let teksLuas = satuan ? `${angkaRapi} ${satuan}` : angkaRapi;
        formattedValue = bagian ? `${teksLuas} (untuk ${bagian})` : teksLuas;
      }
      else if (key === 'jumlahKoleksi') {
        let [angka, satuan] = rawValue.split('|');
        let angkaRapi = parseInt(angka).toLocaleString('id-ID');
        formattedValue = satuan ? `${angkaRapi} ${satuan}` : angkaRapi;
      }
      else if (key === 'kapasitas' || key === 'korban') {
        formattedValue = parseInt(rawValue).toLocaleString('id-ID');
      }
        else if (key === 'ketinggian') {
        formattedValue = parseInt(rawValue).toLocaleString('id-ID') + " mdpl";
      }
else if (key === 'lamanResmi') {
  const displayUrl = rawValue.replace(/^https?:\/\/(www\.)?/, '');
  formattedValue = `<p class="koordinat-link"><a href="${rawValue}" target="_blank" rel="noopener noreferrer" style="word-break: break-all;">${displayUrl}</a></p>`;
}
      else if (key === 'tglTemu' || key === 'tglWafat') {
        let [waktu, presisi] = rawValue.split('|');
        formattedValue = formatWikidataDate(waktu, presisi);
      }
      else if (key === 'bahanList' || key === 'caraList') {
        formattedValue = formattedValue.toLowerCase();
      }
      else if (key === 'bahasaList') {
        formattedValue = formattedValue.replace(/\bbahasa\s+/gi, '');
      }

      html += `<p>${titleLabel}: ${formattedValue}</p>`;
    }
  }

  // ==========================================
  // RENDER BLOK WIKIBOOKS KHUSUS
  // ==========================================
  if (urlWikibooks) {
    // Format UI ini disamakan dengan gaya galeri/arsip
    html += `
      <h2 style="margin-top:20px; margin-bottom:10px;">Resep & Panduan</h2>
      <p class="wikipedia-link" style="margin-bottom: 15px;">
        <a href="${urlWikibooks}" target="_blank">
          <img src="img/wikibook_tiny_logo.png" alt="" />
          <span>Lihat di Wikibuku</span>
        </a>
      </p>
    `;
  }

  let tautanTambah = `<p><a href="${wikiBaseUrl}" target="_blank" class="sunting-linktambah" title="Tambahkan data di Wikidata" style="font-style: italic;">Lengkapi data di Wikidata!</a></p>`;
  html += tautanTambah;

  container.insertAdjacentHTML('beforebegin', html);
  container.remove();
}

function populateProvinceIndex() {
  if (!ProvinceIndex['all']) ProvinceIndex['all'] = new ProvinceIndexEntry();

  Object.values(Records).forEach(record => {
    ProvinceIndex['all'].total++;
    Object.keys(record.designations).forEach(provQid => {
      if (ProvinceIndex[provQid]) {
        ProvinceIndex[provQid].total++;
      }
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
  });
  populateProvinceIndexNodes(); 
  generateFilterSelect();
}

function populateProvinceIndexNodes() {
  Object.values(Records).forEach(record => {
    if (record.mapMarker) ProvinceIndex['all'].mapMarkers.push(record.mapMarker);
    ProvinceIndex['all'].indexLis.push(record.indexLi);
    
    Object.keys(record.designations).forEach(provQid => {
      if (record.mapMarker && ProvinceIndex[provQid]) {
        ProvinceIndex[provQid].mapMarkers.push(record.mapMarker);
      }
      if (ProvinceIndex[provQid]) {
        ProvinceIndex[provQid].indexLis.push(record.indexLi);
      }
    });
  });
  
  Object.values(ProvinceIndex).forEach(indexItem => {
    indexItem.indexLis = indexItem.indexLis
      .map(li => [li, li.textContent])
      .sort((a, b) => a[1] > b[1] ? 1 : -1)
      .map(item => item[0]);
  });
}

var currentRegionFilter = 'all';
var currentUsiaFilter = 'all';
var activeFeatures = new Set(); 
var currentSearchQuery = '';

function generateFilterSelect() {
  currentRegionFilter = 'all';
  currentUsiaFilter = 'all';
  activeFeatures.clear();
  currentSearchQuery = '';

  let selectKombinasi = document.getElementById('filter-sort-kombinasi');
  if (selectKombinasi) {
    selectKombinasi.value = 'default';
    
    if (currentKategoriUtama === 'alam') {
      selectKombinasi.style.display = 'none';
    } else {
      selectKombinasi.style.display = ''; 
    }
  }

  let searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';

  let btnAll = document.getElementById('btn-all');
  if (btnAll) btnAll.classList.add('active');
  document.querySelectorAll('.feat-btn:not(#btn-all)').forEach(b => b.classList.remove('active'));

  let selectRegion = document.getElementById('filter-region');

  selectRegion.innerHTML = `<option value="all">Semua Wilayah – ${ProvinceIndex['all'].total}</option>`;
  
  Object.keys(ProvinceIndex)
    .filter(qid => qid !== 'all')
    .map(qid => { return { qid: qid, name: ProvinceIndex[qid].name, total: ProvinceIndex[qid].total }; })
    .sort((a, b) => {
      if (a.name === 'Tidak dalam Provinsi') return 1;
      if (b.name === 'Tidak dalam Provinsi') return -1;
      return a.name.localeCompare(b.name);
    })
    .forEach(prov => {
      let option = document.createElement('option');
      option.value = prov.qid;
      option.textContent = `${prov.name} – ${prov.total}`;
      selectRegion.appendChild(option);
    });

  applyIntersectionFilter();
  
  if (!isFilterEventAttached) {
    
    selectRegion.addEventListener('change', function() {
      currentRegionFilter = this.value;
      applyIntersectionFilter();
    });

    if (selectKombinasi) {
      selectKombinasi.addEventListener('change', function() {
        let pilihan = this.value;
        currentUsiaFilter = 'all'; 

        if (pilihan === 'filter-usia-50') {
          currentUsiaFilter = 'usia_50'; 
        } else if (pilihan === 'filter-usia-100') {
          currentUsiaFilter = 'usia_100'; 
        } else if (pilihan === 'filter-usia-200') {
          currentUsiaFilter = 'usia_200'; 
        } else if (pilihan === 'filter-usia-300') {
          currentUsiaFilter = 'usia_300'; 
        }
        applyIntersectionFilter();
      });
    }

    if (btnAll) {
      btnAll.addEventListener('click', function() {
        activeFeatures.clear();
        btnAll.classList.add('active');
        document.querySelectorAll('.feat-btn:not(#btn-all)').forEach(b => b.classList.remove('active'));

        currentRegionFilter = 'all';
        if (selectRegion) selectRegion.value = 'all';

        currentUsiaFilter = 'all';
        if (selectKombinasi) selectKombinasi.value = 'default';

        currentSearchQuery = '';
        if (searchInput) searchInput.value = '';

        applyIntersectionFilter();
      });
    }

    document.querySelectorAll('.feat-btn:not(#btn-all)').forEach(btn => {
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
          if (btnAll) btnAll.classList.add('active');
        } else {
          if (btnAll) btnAll.classList.remove('active');
        }

        applyIntersectionFilter();
      });
    });

    if (searchInput) {
      searchInput.addEventListener('input', function() {
        currentSearchQuery = this.value.toLowerCase();
        applyIntersectionFilter(); 
      });
    }

    isFilterEventAttached = true; 
  }
}

function updateFeatureCounts(totalValidRecords) {
  let btnAll = document.getElementById('btn-all');
  let btnImg = document.getElementById('btn-image') || document.querySelector('[data-filter="image"]');
  let btnArt = document.getElementById('btn-article') || document.querySelector('[data-filter="article"]');
  
  if (btnImg) btnImg.textContent = 'Memiliki Gambar';
  if (btnArt) btnArt.textContent = 'Memiliki Artikel';

  let searchInput = document.getElementById('search-input');
  if (searchInput) {
    // === PERUBAHAN PLACEHOLDER SESUAI KLASTER ===
searchInput.placeholder = `Menampilkan ${totalValidRecords} hasil ${currentNamaKlaster.toLowerCase()} (atau ketik yang ingin dicari)`;
  }
}

function applyIntersectionFilter(preventZoom = false) {
  if (!PrimaryDataIsLoaded) return;

  Cluster.clearLayers();
  let ol = document.getElementById('index-list');
  ol.innerHTML = '';

  let validMarkers = [];
  
  let btnAll = document.getElementById('btn-all');
  if (btnAll) {
    if (currentSearchQuery.trim() === '' && 
        currentRegionFilter === 'all' && 
        currentUsiaFilter === 'all' && 
        activeFeatures.size === 0) {
      btnAll.classList.add('active');
      btnAll.textContent = 'Semua Hasil'; 
    } else {
      btnAll.classList.remove('active');
      btnAll.textContent = 'Reset'; 
    }
  }

  let validRecords = Object.values(Records).filter(record => {
    let matchRegion = (currentRegionFilter === 'all' || record.areaTags.has(currentRegionFilter));
    let matchFeature = true;
    
    if (activeFeatures.size > 0) {
      if (activeFeatures.has('image') && !record.imageFilename) matchFeature = false;
      if (activeFeatures.has('article') && record.articleTitle === undefined) matchFeature = false;
    }

    let matchSearch = true;
    if (currentSearchQuery.trim() !== '') {
      let cleanQuery = currentSearchQuery.replace(/[-'\s]/g, '');
      if (record.indexTitle) {
        let cleanTitle = record.indexTitle.toLowerCase().replace(/[-'\s]/g, '');
        matchSearch = cleanTitle.includes(cleanQuery);
      } else {
        matchSearch = false;
      }
    }

    let matchUsia = true;
    if (currentUsiaFilter.startsWith('usia_')) {
      if (record.rawTahunBerdiri) {
        let tahunBangunan = parseInt(record.rawTahunBerdiri.substring(0, 4));
        let batasUmur = parseInt(currentUsiaFilter.split('_')[1]); 
        let batasTahun = new Date().getFullYear() - batasUmur;
        
        matchUsia = tahunBangunan <= batasTahun;
      } else {
        matchUsia = false; 
      }
    }
    
    return matchRegion && matchFeature && matchSearch && matchUsia;

  }).sort((a, b) => {
    if (currentUsiaFilter.startsWith('usia_')) {
      let aHasYear = !!a.rawTahunBerdiri;
      let bHasYear = !!b.rawTahunBerdiri;

      if (aHasYear && bHasYear) {
        return a.rawTahunBerdiri.localeCompare(b.rawTahunBerdiri);
      } else if (aHasYear && !bHasYear) {
        return -1; 
      } else if (!aHasYear && bHasYear) {
        return 1;  
      }
    }
    return a.indexTitle.localeCompare(b.indexTitle);    
  });

  currentFilteredRecords = validRecords;
  currentRenderIndex = 0; 

  renderNextChunk();
  updateFeatureCounts(validRecords.length);

  setTimeout(() => {
    validRecords.forEach(record => {
      if (record.mapMarker) validMarkers.push(record.mapMarker);
    });

    if (validMarkers.length > 0) {
      Cluster.addLayers(validMarkers);
      if (!preventZoom) {
        Map.fitBounds(Cluster.getBounds());
      }
    }
  }, 10);
}

function activateSite(qid) {
  displayRecordDetails(qid); 
  
  populateImportantEventsData(qid);
  populateHistoricalImagesData(qid);

  let record = Records[qid];
  if (record.isCompound) {
    // Kosongkan
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
  let figureHtml = generateFigure(record.imageFilename, record.title);

  if (record.imageFilename) {
    figureHtml = figureHtml.replace('<figure class="', '<figure class="gambar-utama ');
  }

  let articleHtml;
  if (record.articleTitle) {
    articleHtml = '<div class="article main-text loading"><div class="loader"></div></div>';
  } else {
    let namaAmanURL = encodeURIComponent(record.title);
    let gFormUrl = `https://docs.google.com/forms/d/e/1FAIpQLSeHMSn6cwcgbZ0xx1CJ5tGXDQacYgzRZUG51STByKUROWXgmg/viewform?usp=pp_url&entry.2138396049=${namaAmanURL}`;
articleHtml = `<div class="article main-text nodata"><p>${currentNamaKlaster} ini belum memiliki artikel. <a href="${gFormUrl}" target="_blank" rel="noopener noreferrer" class="sunting-linktambah">Tambahkan!</a></p></div>`;
  }
  
let wikiUrlUtama = `https://www.wikidata.org/wiki/${qid}`;
  let tautanSuntingRingkasan = `<a href="${wikiUrlUtama}" target="_blank" class="sunting-link" title="Sunting data di Wikidata" aria-label="Sunting data di Wikidata"></a>`;

  // ==========================================
  // PERBAIKAN 3: RENDER HEADER KLUSTER DINAMIS
  // ==========================================
let isBersejarah = false;
  if (record.rawTahunBerdiri) {
    let tahunBangunan = parseInt(record.rawTahunBerdiri.substring(0, 4));
    if (tahunBangunan <= (new Date().getFullYear() - 50)) isBersejarah = true;
  }

  // Daftar bangunan/struktur fisik yang masuk akal diberi label "Bersejarah"
  let klasterBisaBersejarah = [
    'Masjid', 'Bangunan bersejarah', 'Gereja & katedral'
  ]; 
  
  let teksJudul = `Informasi ${currentNamaKlaster}`;
  if (klasterBisaBersejarah.includes(currentNamaKlaster) && isBersejarah) {
    teksJudul = `Informasi ${currentNamaKlaster} Bersejarah`;
  }

  let designationsHtml = `<h2 style="margin-top:10px">${teksJudul} ${tautanSuntingRingkasan}</h2>`;
  designationsHtml += '<ul class="designations">';

  // Siapkan daftar provinsi & Lokasi
  let arrayProvinsi = Object.values(record.designations).filter(p => p !== 'Tidak dalam Provinsi');
  if (arrayProvinsi.length === 0) arrayProvinsi.push('Indonesia');
  let teksDaftarProvinsi = arrayProvinsi.join(', '); 

  let spesifik = record.lokasiSpesifik; 
  if (spesifik === 'Tidak dalam Provinsi') spesifik = null;

  let namaLokasi = teksDaftarProvinsi;
  if (spesifik && !arrayProvinsi.map(p => p.toLowerCase()).includes(spesifik.toLowerCase())) {
    namaLokasi = `${spesifik}, ${teksDaftarProvinsi}`; 
  }

  // ==========================================
  // LOGIKA 'TERLETAK' (T) & 'DIDIRIKAN' (D)
  // ==========================================
  let prefixLokasi = 'Terletak di'; 
  let showTahun = true; 
  let prefixTahun = 'Didirikan';

  // 1. Pengecualian Khusus (Overrides)
 if (['Wilayah Administratif'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Provinsi';
    prefixTahun = 'Hari jadi';
  } else if (['Tokoh'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Tempat lahir';
    prefixTahun = 'Tanggal lahir';
  } else if (['Latar karya sastra'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Latar';
    prefixTahun = 'Terbit perdana';
  } else if (['Publikasi', 'Media massa'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Tempat terbit';
    prefixTahun = 'Terbit perdana';
  } else if (['Lukisan'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Koleksi';
    prefixTahun = 'Dilukis';
  } else if (['Lontar', 'Naskah'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Koleksi';
    prefixTahun = 'Disalin';
  } else if (['Gempa bumi dan tsunami', 'Peristiwa lainnya', 'Perang & konflik', 'Bencana lainnya'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Tempat kejadian/terdampak';
    prefixTahun = 'Pada';
  } else if (['Menhir & dolmen'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Terletak di';
    prefixTahun = 'Peninggalan';
  }   else if (['Situs arkeologi'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Terletak di';
    prefixTahun = 'Era/periode';
  } else if (['Prasasti', 'Artefak'].includes(currentNamaKlaster)) {
    prefixLokasi = 'Lokasi sekarang';
    prefixTahun = 'Tarikh';
  }
  // 2. Kategori Alam (Mematikan Tahun & Modifikasi Terletak)
  if (currentKategoriUtama === 'alam') {
    showTahun = false;
    
    if (['Bahasa'].includes(currentNamaKlaster)) {
      prefixLokasi = 'Wilayah penutur utama';
    } else if (['Hidangan', 'Pakaian', 'Tari dan pertunjukan', 'Ritual dan upacara', 'Budaya rakyat'].includes(currentNamaKlaster)) {
      prefixLokasi = `${currentNamaKlaster} khas`;
    } else {
      // Untuk sisanya seperti RTH, Kebun Binatang, Gunung, Air Terjun, dll.
      // Tetap menggunakan default prefixLokasi = 'Terletak di'
      prefixLokasi = 'Terletak di';
    }
  }

  // 3. Render HTML Lokasi
  let infoLokasiHtml = '';
  if (record.lat && record.lon) {
    let mapsUrl = `https://www.google.com/maps?q=${record.lat},${record.lon}`;
    infoLokasiHtml = `<p class="koordinat-link">${prefixLokasi}: <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" title="Buka di Google Maps">${namaLokasi}</a></p>`;
  } else {
    infoLokasiHtml = 
      `<p class="koordinat-link">${prefixLokasi}: ${namaLokasi}</p>` +
      `<p>Koordinat: <span style="font-style: italic; color: #888;">Data belum tersedia</span></p>`;
  }

  // 4. Render HTML Tahun (Hanya dicetak jika showTahun === true)
  let infoTahunHtml = '';
  if (showTahun) {
    if (record.tahunBerdiri) {
      infoTahunHtml = `<p>${prefixTahun}: ${record.tahunBerdiri}</p>`;
    } else {
      infoTahunHtml = `<p>${prefixTahun}: <span style="font-style: italic; color: #888;">Data belum tersedia</span></p>`;
    }
  }

  // Sisa perakitan HTML ke panel...
  let eventsHtmlPlaceholder = `
    <div id="events-container-${qid}" class="loading" style="margin-top: 8px; min-height: 24px;">
      <div class="loader" style="width: 20px; height: 20px; border-width: 2px; margin: 0;"></div>
    </div>`;

  designationsHtml +=
    '<li>' +
      infoLokasiHtml + 
      infoTahunHtml +
      eventsHtmlPlaceholder + 
    '</li>';
      
  designationsHtml += '</ul>';

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

function populateHistoricalImagesData(qid) {
  let record = Records[qid];
  let queryStr = getSparqlQuery5(qid); 

  record.vicinityImages = [];
  record.pastImage = undefined;
  record.interiorImage = undefined; 
  record.commonsCat = undefined; 

  return queryWdqsThenProcess(
    queryStr,
    function(result) {
      if ('vicinityImage' in result) {
        let filename = extractImageFilename(result.vicinityImage);
        let captionText = result.vicinityCaption ? result.vicinityCaption.value : '';
        
        let isDuplicate = record.vicinityImages.some(img => img.file === filename);
        if (!isDuplicate) {
          record.vicinityImages.push({ file: filename, caption: captionText });
        }
      }
      
      if ('pastImage' in result) {
        if (!record.pastImage) { 
          let filename = extractImageFilename(result.pastImage);
          let captionText = result.pastCaption ? result.pastCaption.value : '';
          record.pastImage = { file: filename, caption: captionText };
        }
      }

      if ('interiorImage' in result) {
        if (!record.interiorImage) { 
          let filename = extractImageFilename(result.interiorImage);
          let captionText = result.interiorCaption ? result.interiorCaption.value : '';
          record.interiorImage = { file: filename, caption: captionText };
        }
      }
      
      if ('commonsCat' in result) {
        record.commonsCat = result.commonsCat.value;
      }
    },
    function() {
      renderHistoricalImagesInPanel(qid);
    }
  );
}

function renderHistoricalImagesInPanel(qid) {
  let record = Records[qid];
  
  if (!record.panelElem) return;
  let container = record.panelElem.querySelector(`#arsip-container-${qid}`);
  if (!container) return; 

  let html = '';
  
  function buildImageBlock(imgObj, teksPengganti) {
    let block = '<div class="arsip-block" style="overflow: hidden; margin-bottom: 10px;">';
    block += generateFigure(imgObj.file);
    if (imgObj.caption && imgObj.caption.trim() !== '') {
      block += `<div class="article main-text"><p>${imgObj.caption}</p></div>`;
    } else {
      block += `<div class="article main-text nodata"><p>${teksPengganti}</p></div>`;
    }
    block += '</div>';
    return block;
  }

  if (record.pastImage) {
    html += buildImageBlock(record.pastImage, 'Suasana/bentuk/tampilan sebelumnya');
  }

  if (record.interiorImage) {
    html += buildImageBlock(record.interiorImage, 'Pemandangan di dalam');
  }
  
  if (record.vicinityImages && record.vicinityImages.length > 0) {
    record.vicinityImages.forEach(imgObj => {
      html += buildImageBlock(imgObj, 'Objek di sekitar');
    });
  }

  if (record.commonsCat) {
    html += '<h2 style="margin-bottom:10px;">Galeri lainnya</h2>';
    html += 
      '<p class="wikipedia-link" style="margin-bottom: 0;">' +
        `<a href="https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(record.commonsCat)}" target="_blank">` +
          '<img src="img/wikicommons_tiny_logo.png" alt="" />' +
          '<span>Lihat di Wikimedia Commons</span>' +
        '</a>' +
      '</p>';
  }

  if (html !== '') {
    let wikiUrlGaleri = `https://www.wikidata.org/wiki/${qid}#P18`;
    let tautanSuntingGaleri = `<a href="${wikiUrlGaleri}" target="_blank" class="sunting-link" title="Sunting data galeri di Wikidata" aria-label="Sunting data galeri di Wikidata"></a>`;
    
    let judulGaleriUtama = '';
    if (record.pastImage || record.interiorImage || (record.vicinityImages && record.vicinityImages.length > 0)) {
      judulGaleriUtama = `<h2 style="margin-bottom:15px;">Galeri ${tautanSuntingGaleri}</h2>`;
    }
    
    container.innerHTML = judulGaleriUtama + html;
    container.classList.remove('loading');
  } else {
    container.innerHTML = '';
    container.classList.remove('loading');
    container.style.display = 'none';
  }
}

function displayArticleExtract(title, elem) {
  // 1. Siapkan URL dan Parameter
  let url = new URL('https://id.wikipedia.org/w/api.php');
  let params = {
    action: 'query',
    format: 'json',
    prop: 'extracts',
    exintro: 1,
    redirects: true,
    titles: title,
    origin: '*' // Kunci wajib agar terhindar dari blokir keamanan CORS browser
  };
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

  // 2. Eksekusi Fetch API
  fetch(url)
    .then(response => {
      if (!response.ok) throw new Error('Koneksi ke server Wikipedia gagal');
      return response.json();
    })
    .then(data => {
      // Proteksi jika data Wikipedia kosong/tidak valid
      if (!data.query || !data.query.pages) {
        throw new Error('Struktur data Wikipedia tidak ditemukan');
      }

      let rawExtract = Object.values(data.query.pages)[0].extract || '';
      
      let kumpulanParagraf = rawExtract.match(/<p[^>]*>[\s\S]+?<\/p>/g);
      let paragrafPilihan = kumpulanParagraf ? kumpulanParagraf.find(text => text.length > 50) : null;

      if (paragrafPilihan) {
        paragrafPilihan = paragrafPilihan.replace(/^<p[^>]*>(\s|<br\s*\/?>| )*/i, '<p>');
        paragrafPilihan = paragrafPilihan.replace(/<span[^>]*>[^<]*code:\s*[a-z\-]+\s*is deprecated[^<]*<\/span>/gi, '');
        paragrafPilihan = paragrafPilihan.replace(/<[^>]*>[^<]*(is deprecated|Lua error|Script error)[^<]*<\/[^>]*>/gi, '');
        paragrafPilihan = paragrafPilihan.replace(/code:\s*[a-z\-]+\s*is deprecated/gi, '');
      } else {
        paragrafPilihan = '<p>Ringkasan artikel belum memadai.</p>'; 
      }

      // Cetak hasil ke dalam HTML
      elem.innerHTML =
        paragrafPilihan +
        '<p class="wikipedia-link">' +
          `<a href="https://id.wikipedia.org/wiki/${encodeURIComponent(title)}" target="_blank">` +
            '<img src="img/wikipedia_tiny_logo.png" alt="" />' +
            '<span>Baca selengkapnya di Wikipedia</span>' +
          '</a>' +
        '</p>';
        
      // Matikan animasi loading dengan menghapus class
      elem.classList.remove('loading');
    })
    .catch(error => {
      console.error('Gagal memuat artikel Wikipedia:', error);
      
      // JIKA GAGAL: Beri pesan error dan MATIKAN animasi loading
      elem.innerHTML = '<p class="nodata" style="color:#cc0000; margin-top:10px;">Gagal memuat ringkasan artikel. Periksa koneksi internet Anda.</p>';
      elem.classList.remove('loading');
    });
}

function renderNextChunk() {
  let ol = document.getElementById('index-list');
  if (!ol) return;

  let nextBatch = currentFilteredRecords.slice(currentRenderIndex, currentRenderIndex + CHUNK_SIZE);  
  if (nextBatch.length === 0) return;
  
  let fragment = document.createDocumentFragment();

  nextBatch.forEach(record => {
    if (record.indexLi) {
      record.indexLi.style.display = '';
      fragment.appendChild(record.indexLi);
    }
  });

  ol.appendChild(fragment);
  currentRenderIndex += CHUNK_SIZE; 
}

let scrollContainer = document.getElementById('index-container'); 

if (scrollContainer) {
  scrollContainer.addEventListener('scroll', function() {
    if (this.scrollTop + this.clientHeight >= this.scrollHeight - 10) {
      renderNextChunk(); 
    }
  });
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
  way      ["wikidata"="${qid}"];
  relation ["wikidata"="${qid}"];
);
out body;
>;
out skel qt;`
    ),
    true,
  );
  xhr.send();
}

class ProvinceIndexEntry {
  constructor() {
    this.name       = '';
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
    this.interiorImage = undefined;
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
