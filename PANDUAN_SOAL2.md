# PANDUAN PENGERJAAN SOAL 2 - Proyek Infrastruktur NERV
# Ganti [XX] dengan nomor kelompok kalian (contoh: 03)

## LANGKAH 0 - Persiapan Struktur Folder

```bash
mkdir -p nerv-db-project
cd nerv-db-project
# Salin file Dockerfile, entrypoint.sh, dan setup_db.sql ke folder ini
```

---

## LANGKAH 1 - Build Image Docker

```bash
# Build image dari Dockerfile
docker build -t database-shinji:latest .
```

---

## LANGKAH 2 - Jalankan Container dengan Volume, CPU, dan RAM

```bash
# Jalankan container dengan:
# - Nama: database-shinji
# - Volume bind mount dari folder lokal ke /var/data/db di container
# - 2 CPU dan 2048 MB RAM
# - Port 3306 di-expose

docker run -d \
  --name database-shinji \
  --cpus="2" \
  --memory="2048m" \
  -v "$(pwd):/var/data/db" \
  -p 3306:3306 \
  database-shinji:latest
```

---

## LANGKAH 3 - Verifikasi Container Berjalan

```bash
# Cek container aktif
docker ps

# Cek log container
docker logs database-shinji
```

---

## LANGKAH 4 - Masuk ke Dalam Container dan Verifikasi MariaDB

```bash
# Masuk ke dalam container
docker exec -it database-shinji bash

# Di dalam container, cek status MariaDB:
mysqladmin -u root status

# Atau cek versi MariaDB:
mysql --version

# Keluar dari container
exit
```

---

## LANGKAH 5 - Buat Database dan Tabel

```bash
# Salin file SQL ke dalam container
docker cp setup_db.sql database-shinji:/setup_db.sql

# Jalankan script SQL (ganti XX dengan nomor kelompok)
docker exec -it database-shinji bash -c \
  "sed -i 's/modul1_XX_database/modul1_[XX]_database/g' /setup_db.sql && mysql -u root < /setup_db.sql"
```

### ATAU: Masuk manual ke MySQL

```bash
docker exec -it database-shinji mysql -u root

# Kemudian jalankan perintah SQL berikut satu per satu:
CREATE DATABASE modul1_XX_database;
USE modul1_XX_database;

CREATE TABLE pilots (
    NRP VARCHAR(20) NOT NULL PRIMARY KEY,
    Nama VARCHAR(100) NOT NULL,
    Departemen VARCHAR(100) NOT NULL
);

INSERT INTO pilots VALUES
('5026231001', 'Nama Praktikan 1', 'Informatika'),
('5026231002', 'Nama Praktikan 2', 'Informatika'),
('5026231003', 'Nama Praktikan 3', 'Informatika');

SELECT * FROM pilots;
EXIT;
```

---

## LANGKAH 6 - Verifikasi Volume Bekerja

```bash
# Buat file di folder lokal (host)
echo "test dari host" > test_volume.txt

# Verifikasi file muncul di dalam container
docker exec database-shinji ls /var/data/db
docker exec database-shinji cat /var/data/db/test_volume.txt
```

---

## RINGKASAN PERINTAH PENTING

| Tujuan | Perintah |
|--------|----------|
| Build image | `docker build -t database-shinji:latest .` |
| Jalankan container | `docker run -d --name database-shinji --cpus="2" --memory="2048m" -v "$(pwd):/var/data/db" -p 3306:3306 database-shinji:latest` |
| Cek container | `docker ps` |
| Masuk container | `docker exec -it database-shinji bash` |
| Masuk MySQL | `docker exec -it database-shinji mysql -u root` |
| Lihat log | `docker logs database-shinji` |
| Stop container | `docker stop database-shinji` |
| Hapus container | `docker rm database-shinji` |
