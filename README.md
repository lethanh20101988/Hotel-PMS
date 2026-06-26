# Du an SME Hotel

Monorepo cho he thong SME Hotel, gom web app, mobile app va script ha tang.

## Cau truc thu muc

```text
.
|-- Hotel UIUX/             # Web app chinh: frontend React/Vite, backend Node/Express, Docker
|-- Hotel/mp-hotel/         # Mobile app
|-- infra/                  # Script ha tang, Cloudflare tunnel
|-- docker-compose.sme-hotel.yml
`-- README.md
```

Thu muc `Hotel data/` chua du lieu runtime/local database va khong duoc commit len GitHub.

## Yeu cau moi truong

- Node.js phu hop voi tung package trong du an
- npm
- Docker Desktop neu chay bang Docker
- Git for Windows de commit/push len GitHub

## Chay web app bang Docker

Tu thu muc goc `E:\Dự án SME Hotel`:

```powershell
docker compose -f "docker-compose.sme-hotel.yml" up --build
```

Mac dinh frontend chay tai:

```text
http://localhost:3180
```

## Chay rieng tung phan

Web app:

```powershell
cd "E:\Dự án SME Hotel\Hotel UIUX"
npm install
npm run dev
```

Mobile app:

```powershell
cd "E:\Dự án SME Hotel\Hotel\mp-hotel"
npm install
npm run dev
```

## Du lieu va secret

Khong commit cac muc sau:

- `Hotel data/`
- `node_modules/`
- `.npm-cache/`
- `dist/`, `build/`
- `.env`, `.env.*`, `.env.sme-hotel`
- File database `*.db`, `*.sqlite`, `*.sqlite3`
- Token/credential Cloudflare hoac file secret khac

Neu can chia se cau hinh, tao file `.env.example` voi gia tri mau, khong dung secret that.

## Dua len GitHub

Sau khi cai Git for Windows:

```powershell
cd "E:\Dự án SME Hotel"
git status
git add .
git status
git commit -m "Initial commit: SME Hotel source code"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

Truoc khi commit, kiem tra de dam bao khong co file lon/secret:

```powershell
git status --short
```

Neu thay `node_modules`, `Hotel data`, `.env`, hoac file database trong danh sach commit thi dung lai va cap nhat `.gitignore` truoc.
